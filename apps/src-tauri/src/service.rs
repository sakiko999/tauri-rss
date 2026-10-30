//! 数据服务生命周期（Tauri 侧）。
//!
//! `service_endpoint`：adopt 已运行的 endpoint，或 spawn
//! `amoeba-runtime.exe service.js --service ...`，读 stdout 的 `READY <port>`，
//! 把 endpoint.json 原样交给 renderer（client token 在里面；owner token 不出 Rust）。
//!
//! 退出：主窗口销毁 → POST /v1/shutdown（owner token）→ 等 3s → kill。
//! 服务自己还会按 `--parent-pid` 轮询 Tauri 进程，双保险。
use std::collections::VecDeque;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::Value;
use tauri::{AppHandle, Manager};

const PROTOCOL: i64 = 1;
const READY_TIMEOUT: Duration = Duration::from_secs(30);
const ADOPT_WAIT: Duration = Duration::from_secs(5);
const DEFAULT_DB: &str = "rss.dev.db";

#[derive(Default)]
pub struct ServiceState {
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    /// 只有 desktop 自己 spawn 的服务才归它关；adopt 的进程不动。
    owned: Option<Child>,
    endpoint: Option<Value>,
    owner_token: Option<String>,
    /// 最近 stderr 行（诊断用；失败时拼进错误）。
    stderr_tail: Arc<Mutex<VecDeque<String>>>,
}

struct Paths {
    data_dir: PathBuf,
    db_path: PathBuf,
    profile_dir: PathBuf,
    token_file: PathBuf,
    endpoint_file: PathBuf,
    launcher: PathBuf,
    entry: PathBuf,
    sidecar: Option<PathBuf>,
}

fn exe_name(stem: &str) -> String {
    if cfg!(windows) {
        format!("{stem}.exe")
    } else {
        stem.to_string()
    }
}

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."))
}

/// identifier 拆分（2026-10）前三种运行形态共用的旧身份目录名。
const LEGACY_IDENTIFIER: &str = "app.amoeba.desktop";

/// tasklist 探活：旧身份数据服务还开着时不搬它的库（WAL 活写时拷贝会撕裂）。
#[cfg(windows)]
fn pid_alive(pid: u32) -> bool {
    use std::os::windows::process::CommandExt;
    let mut cmd = std::process::Command::new("tasklist");
    cmd.args(["/FI", &format!("PID eq {pid}"), "/NH"]);
    // release 是 GUI 子系统，不隐藏会闪控制台（见 webview_browser.rs 同款注释）。
    cmd.creation_flags(0x0800_0000);
    match cmd.output() {
        Ok(o) => String::from_utf8_lossy(&o.stdout).contains(&format!("{pid} ")),
        Err(_) => false,
    }
}

/// 非 Windows 不做活源防护（桌面抓取/服务以 Windows 为主，容错优先迁移成功）。
#[cfg(not(windows))]
fn pid_alive(_pid: u32) -> bool {
    false
}

/// 旧身份服务锁里的 pid（锁格式见 server.ts 的 instance.lock）。
fn lock_pid(path: &Path) -> Option<u32> {
    let text = std::fs::read_to_string(path).ok()?;
    let value: Value = serde_json::from_str(&text).ok()?;
    value.get("pid")?.as_u64()?.try_into().ok()
}

/// `foo.db` → `foo.db-wal` / `foo.db.migrating`（OsString 拼接，不经显示编码）。
fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut s = path.as_os_str().to_os_string();
    s.push(suffix);
    PathBuf::from(s)
}

/// 两个既有路径是否指向同一文件（Windows 大小写不敏感；任一不存在 = 不同）。
fn same_file(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => {
            a == b || a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
        }
        _ => false,
    }
}

/// identifier 拆分的一次性迁移：把旧共享目录里的 dev 库搬到新身份目录。
///
/// - 原子性：先拷成 `<db>.migrating` 再 rename 落位 —— 半截目标库会让
///   「目标不存在才迁」的条件永久失效，等于把 dev 库钉死在损坏状态。
/// - 防复活：迁移成功后 legacy 改名 `.migrated` —— 用户删 dev 库重置时，
///   不会下次启动又从旧目录把数据搬回来。
/// - `-shm` 不搬（共享内存索引，SQLite 打开时自己重建）。
fn migrate_legacy_shared_db(new_data: &Path, new_local: &Path, db_path: &Path, db_file: &str) {
    // rss.db 只属于正式版身份，绝不触碰。
    if db_file == "rss.db" || db_path.exists() {
        return;
    }
    let Some(legacy_db) = new_data.parent().map(|p| p.join(LEGACY_IDENTIFIER).join(db_file)) else {
        return;
    };
    if !legacy_db.is_file() {
        return;
    }
    // 活源防护：旧目录的服务若正开着**待迁移的这个库**（WAL 活写拷贝会撕裂）→ 推迟。
    // ⚠️ 不能只看 instance.lock —— 锁属于 desktop 身份的服务，安装版开着 rss.db 时
    // 锁也活着，但它不碰 dev 库；判据是 endpoint.json 的 dbFile。endpoint 不可读
    // （服务启动中/损坏）才退回锁 + pid 探活，保守推迟。
    let legacy_service = new_local
        .parent()
        .map(|p| p.join(LEGACY_IDENTIFIER).join("service"));
    if let Some(service_dir) = legacy_service {
        let owner_db = read_endpoint(&service_dir.join("endpoint.json"))
            .and_then(|v| v.get("dbFile").and_then(Value::as_str).map(str::to_string));
        match owner_db {
            Some(db) if same_file(Path::new(&db), &legacy_db) => {
                eprintln!("[service] 旧身份服务正持有该库（{db}），dev 库迁移推迟到下次启动");
                return;
            }
            Some(_) => { /* desktop 身份服务开着别的库（如安装版的 rss.db）：不碰 dev 库，继续 */ }
            None => {
                if let Some(pid) = lock_pid(&service_dir.join("instance.lock")) {
                    if pid_alive(pid) {
                        eprintln!("[service] 旧身份服务启动中(pid={pid})，dev 库迁移推迟到下次启动");
                        return;
                    }
                }
            }
        }
    }
    let Some(parent) = db_path.parent() else { return };
    if let Err(e) = std::fs::create_dir_all(parent) {
        eprintln!("[service] 迁移：创建目录失败 {}: {e}", parent.display());
        return;
    }
    let tmp = with_suffix(db_path, ".migrating");
    let legacy_wal = with_suffix(&legacy_db, "-wal");
    if let Err(e) = std::fs::copy(&legacy_db, &tmp) {
        eprintln!("[service] 迁移：拷贝失败 {}: {e}", legacy_db.display());
        let _ = std::fs::remove_file(&tmp);
        return;
    }
    if legacy_wal.is_file() {
        let tmp_wal = with_suffix(db_path, ".migrating-wal");
        if let Err(e) = std::fs::copy(&legacy_wal, &tmp_wal) {
            eprintln!("[service] 迁移：拷贝 WAL 失败 {}: {e}", legacy_wal.display());
            let _ = std::fs::remove_file(&tmp);
            let _ = std::fs::remove_file(&tmp_wal);
            return;
        }
    }
    // 落位顺序：WAL 先、主库后（主库 rename 即提交点；中途崩溃 → 目标缺失 → 整体重来，
    // copy 会覆盖上次残留的 tmp；Windows 的 rename 不覆盖已存在目标，先清半途的 WAL）。
    let wal_target = with_suffix(db_path, "-wal");
    if wal_target.exists() {
        let _ = std::fs::remove_file(&wal_target);
    }
    let tmp_wal = with_suffix(db_path, ".migrating-wal");
    if tmp_wal.is_file() {
        if let Err(e) = std::fs::rename(&tmp_wal, &wal_target) {
            eprintln!("[service] 迁移：WAL 落位失败: {e}");
            let _ = std::fs::remove_file(&tmp);
            return;
        }
    }
    if let Err(e) = std::fs::rename(&tmp, db_path) {
        eprintln!("[service] 迁移：主库落位失败: {e}");
        let _ = std::fs::remove_file(&tmp);
        return;
    }
    eprintln!(
        "[service] dev 库已从旧共享目录迁移：{} → {}",
        legacy_db.display(),
        db_path.display()
    );
    // best-effort：失败只意味着旧库残留（可手删），不影响已落位的新库。
    let _ = std::fs::rename(&legacy_db, with_suffix(&legacy_db, ".migrated"));
    let _ = std::fs::rename(&legacy_wal, with_suffix(&legacy_wal, "-migrated"));
}

fn target_dir() -> PathBuf {
    repo_root().join("target").join(if cfg!(debug_assertions) {
        "debug"
    } else {
        "release"
    })
}

fn resolve_paths(app: &AppHandle, db_file: &str) -> Result<Paths, String> {
    let db_file = if db_file.is_empty() {
        DEFAULT_DB
    } else {
        db_file
    };
    if !matches!(db_file, "rss.db" | "rss.dev.db" | "rss.release-debug.db") {
        return Err(format!("dbFile 不在白名单内：{db_file}"));
    }
    let local = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("app_local_data_dir: {e}"))?;
    let data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    let data_dir = local.join("service");
    let profile_dir = local.join("webview-profile");
    let db_path = data.join(db_file);
    let token_file = data_dir.join("service.token");
    let endpoint_file = data_dir.join("endpoint.json");
    // identifier 拆分的一次性迁移（dev 库从旧共享目录搬进来；目标已存在即 no-op）。
    migrate_legacy_shared_db(&data, &local, &db_path, db_file);

    let (launcher, entry, sidecar) = if cfg!(debug_assertions) {
        let target = target_dir();
        (
            target.join(exe_name("amoeba-runtime")),
            // dev 直接跑 TS，避免 dist/service/service.js 与源码不一致。
            repo_root().join("apps/cli/src/service/main.ts"),
            Some(target.join(exe_name("amoeba-browser"))),
        )
    } else {
        let res = app
            .path()
            .resource_dir()
            .map_err(|e| format!("resource_dir: {e}"))?;
        let packed = (
            res.join(exe_name("amoeba-runtime")),
            res.join("service").join("service.js"),
            Some(res.join(exe_name("amoeba-browser"))),
        );
        // 安装版：三件资源由 tauri-build 复制进 resource_dir。
        // ⚠️ `bun run tauri:release`（= `tauri dev --release`）不叠 tauri.conf.release.json，
        // 资源不会进 target/release —— 此时回退到仓库产物，否则文档里的 release 调试
        // 入口启动后拿不到数据服务（进程内回退已删，整个工作台不可用）。
        if packed.1.is_file() {
            packed
        } else {
            let target = target_dir();
            (
                target.join(exe_name("amoeba-runtime")),
                repo_root().join("dist").join("service").join("service.js"),
                Some(target.join(exe_name("amoeba-browser"))),
            )
        }
    };

    Ok(Paths {
        data_dir,
        db_path,
        profile_dir,
        token_file,
        endpoint_file,
        launcher,
        entry,
        sidecar: sidecar.filter(|p| p.is_file()),
    })
}

fn read_endpoint(path: &Path) -> Option<Value> {
    let text = std::fs::read_to_string(path).ok()?;
    let value: Value = serde_json::from_str(&text).ok()?;
    (value.get("schema")?.as_str()? == "amoeba-service/1").then_some(value)
}

fn endpoint_port(value: &Value) -> Option<u16> {
    value.get("port")?.as_u64()?.try_into().ok()
}

fn client_token(value: &Value) -> Option<&str> {
    value.get("clientToken")?.as_str()
}

fn health_ok(value: &Value) -> bool {
    let Some(port) = endpoint_port(value) else {
        return false;
    };
    let Some(token) = client_token(value) else {
        return false;
    };
    let client = match reqwest::blocking::Client::builder()
        .timeout(Duration::from_millis(1_500))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    let resp = client
        .get(format!("http://127.0.0.1:{port}/v1/hello"))
        .bearer_auth(token)
        .send();
    let Ok(resp) = resp else {
        return false;
    };
    if !resp.status().is_success() {
        return false;
    }
    resp.json::<Value>()
        .map(|v| v.get("protocol").and_then(Value::as_i64) == Some(PROTOCOL))
        .unwrap_or(false)
}

fn wait_for_endpoint(path: &Path, timeout: Duration) -> Option<Value> {
    let start = Instant::now();
    loop {
        if let Some(value) = read_endpoint(path) {
            if health_ok(&value) {
                return Some(value);
            }
        }
        if start.elapsed() >= timeout {
            return None;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn tail(tail: &Arc<Mutex<VecDeque<String>>>) -> String {
    let guard = tail.lock().ok();
    guard
        .map(|g| g.iter().cloned().collect::<Vec<_>>().join("\n"))
        .unwrap_or_default()
}

fn drain_stderr(stderr: std::process::ChildStderr, tail: Arc<Mutex<VecDeque<String>>>) {
    let reader = BufReader::new(stderr);
    for line in reader.lines().map_while(Result::ok) {
        if let Ok(mut guard) = tail.lock() {
            guard.push_back(line);
            while guard.len() > 40 {
                guard.pop_front();
            }
        }
    }
}

fn drain_stdout(stdout: std::process::ChildStdout, ready_tx: mpsc::Sender<String>) {
    let reader = BufReader::new(stdout);
    for line in reader.lines().map_while(Result::ok) {
        // READY 只发一次；之后继续 drain，防管道写满。
        let _ = ready_tx.send(line);
    }
}

fn spawn_service(paths: &Paths) -> Result<(Child, u16), String> {
    if !paths.launcher.is_file() {
        let hint = if cfg!(debug_assertions) {
            "cargo build -p amoeba-runtime"
        } else {
            "cargo build --release -p amoeba-runtime"
        };
        return Err(format!(
            "找不到运行时启动器：{}\n先运行 `{hint}`",
            paths.launcher.display()
        ));
    }
    if !paths.entry.is_file() {
        return Err(format!(
            "找不到服务入口：{}\nrelease 构建先运行 `bun run service:build`",
            paths.entry.display()
        ));
    }
    std::fs::create_dir_all(&paths.data_dir).map_err(|e| format!("创建数据目录失败：{e}"))?;
    std::fs::create_dir_all(&paths.profile_dir)
        .map_err(|e| format!("创建 profile 目录失败：{e}"))?;

    let mut cmd = Command::new(&paths.launcher);
    cmd.arg(&paths.entry)
        .arg("--service")
        .arg("--data-dir")
        .arg(&paths.data_dir)
        .arg("--db")
        .arg(&paths.db_path)
        .arg("--profile-dir")
        .arg(&paths.profile_dir)
        .arg("--token-file")
        .arg(&paths.token_file)
        .arg("--parent-pid")
        .arg(std::process::id().to_string());
    if let Some(sidecar) = &paths.sidecar {
        cmd.arg("--browser-sidecar").arg(sidecar);
    } else {
        cmd.arg("--no-browser");
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // 0x08000000 = CREATE_NO_WINDOW：Tauri 是 GUI，别闪控制台。
        cmd.creation_flags(0x0800_0000);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("启动服务失败（{}）：{e}", paths.launcher.display()))?;
    let stdout = child.stdout.take().ok_or("服务 stdout 未捕获")?;
    let stderr = child.stderr.take().ok_or("服务 stderr 未捕获")?;
    let tail_buf = Arc::new(Mutex::new(VecDeque::new()));
    std::thread::spawn({
        let tail = Arc::clone(&tail_buf);
        move || drain_stderr(stderr, tail)
    });

    let (tx, rx) = mpsc::channel::<String>();
    std::thread::spawn(move || drain_stdout(stdout, tx));

    let deadline = Instant::now() + READY_TIMEOUT;
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            let _ = child.kill();
            return Err(format!("服务 30s 内未 READY\n{}", tail(&tail_buf)));
        }
        match rx.recv_timeout(left) {
            Ok(line) => {
                if let Some(port) = line
                    .strip_prefix("READY ")
                    .and_then(|s| s.trim().parse::<u16>().ok())
                {
                    return Ok((child, port));
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                let _ = child.kill();
                return Err(format!("服务 30s 内未 READY\n{}", tail(&tail_buf)));
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                let status = child.wait().ok();
                let code = status.and_then(|s| s.code());
                // 退出码 3 = 已有实例；等 endpoint 出现后 adopt。
                if code == Some(3) {
                    return Err("ALREADY_RUNNING".into());
                }
                return Err(format!(
                    "服务启动即退出（code {:?}）\n{}",
                    code,
                    tail(&tail_buf)
                ));
            }
        }
    }
}

fn ensure_service(
    paths: &Paths,
    stderr_tail: Arc<Mutex<VecDeque<String>>>,
) -> Result<(Value, Option<Child>, Option<String>), String> {
    if let Some(endpoint) = read_endpoint(&paths.endpoint_file) {
        if health_ok(&endpoint) {
            return Ok((endpoint, None, None));
        }
    }

    match spawn_service(paths) {
        Ok((child, _port)) => {
            let endpoint =
                wait_for_endpoint(&paths.endpoint_file, ADOPT_WAIT).ok_or_else(|| {
                    format!(
                        "服务 READY 但 endpoint 不可用：{}",
                        paths.endpoint_file.display()
                    )
                })?;
            let owner_token = std::fs::read_to_string(&paths.token_file)
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            Ok((endpoint, Some(child), owner_token))
        }
        Err(err) if err == "ALREADY_RUNNING" => {
            let endpoint =
                wait_for_endpoint(&paths.endpoint_file, ADOPT_WAIT).ok_or_else(|| {
                    format!(
                        "另一个实例已运行，但 endpoint 不可用\n{}",
                        tail(&stderr_tail)
                    )
                })?;
            Ok((endpoint, None, None))
        }
        Err(err) => Err(err),
    }
}

fn post_shutdown(endpoint: &Value, token: &str) -> bool {
    let Some(port) = endpoint_port(endpoint) else {
        return false;
    };
    let Ok(client) = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
    else {
        return false;
    };
    client
        .post(format!("http://127.0.0.1:{port}/v1/shutdown"))
        .bearer_auth(token)
        .send()
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

/// 关服务的等待上限：必须**大于** sidecar 的关闭超时（`CLOSE_TIMEOUT_MS = 5s`，cookie flush），
/// 否则安装器会撞上还在退出的 `amoeba-browser.exe`（更新卡在「browser 还未完全退出」）。
const SHUTDOWN_WAIT: Duration = Duration::from_secs(8);

/// 更新安装前由前端显式调用（幂等）。
///
/// ⚠️ Windows 上 `updater.install()` 走 `std::process::exit(0)`（插件文档原话），
/// **不触发** `RunEvent::ExitRequested` —— 只靠退出钩子停服务，安装器会在
/// 服务/sidecar 还在退时开始替换文件。
#[tauri::command]
pub fn service_shutdown(state: tauri::State<'_, ServiceState>) {
    shutdown(&state);
}

/// 主窗口销毁 / 应用退出（含 updater 的 `app.exit(0)`）时调用（幂等）。
pub fn shutdown(state: &ServiceState) {
    let mut inner = match state.inner.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    let Some(mut child) = inner.owned.take() else {
        return;
    };
    if let (Some(endpoint), Some(token)) = (inner.endpoint.clone(), inner.owner_token.clone()) {
        let _ = post_shutdown(&endpoint, &token);
    }
    let deadline = Instant::now() + SHUTDOWN_WAIT;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(100)),
            _ => break,
        }
    }
    // 超时：杀**整棵进程树**（launcher → bun → amoeba-browser）。只 kill launcher 会让
    // sidecar 继续存活，安装器替换文件时报「browser 还未完全退出」。
    let pid = child.id().to_string();
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", pid.as_str()])
            .output();
    }
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_base() -> PathBuf {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!(
            "amoeba-service-test-{}-{stamp}",
            std::process::id()
        ))
    }

    #[test]
    fn spawns_service_reads_endpoint_and_shuts_down() {
        let base = temp_base();
        let data_dir = base.join("data");
        let paths = Paths {
            data_dir: data_dir.clone(),
            db_path: base.join("rss.db"),
            profile_dir: base.join("profile"),
            token_file: data_dir.join("service.token"),
            endpoint_file: data_dir.join("endpoint.json"),
            launcher: target_dir().join(exe_name("amoeba-runtime")),
            entry: repo_root().join("apps/cli/src/service/main.ts"),
            sidecar: None,
        };
        std::fs::create_dir_all(&data_dir).expect("mkdir data");
        let tail_buf = Arc::new(Mutex::new(VecDeque::new()));

        let (endpoint, mut child, owner) = ensure_service(&paths, tail_buf).expect("service spawn");
        assert!(endpoint_port(&endpoint).is_some(), "endpoint port");
        assert!(health_ok(&endpoint), "service health");
        assert!(child.is_some(), "spawned child should be owned");

        let token = owner.expect("owner token");
        assert!(post_shutdown(&endpoint, &token), "shutdown request");

        let child = child.as_mut().unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(100))
                }
                _ => {
                    let _ = child.kill();
                    panic!("service did not exit after shutdown");
                }
            }
        }
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn migrates_legacy_dev_db_once() {
        let base = temp_base();
        // 模拟真实布局：库目录在 Roaming、服务目录在 Local（两个不同根，见 resolve_paths）。
        let roaming = base.join("Roaming");
        let local = base.join("Local");
        let new_data = roaming.join("app.amoeba.dev");
        let new_local = local.join("app.amoeba.dev");
        let legacy = roaming.join("app.amoeba.desktop");
        let legacy_service = local.join("app.amoeba.desktop").join("service");
        std::fs::create_dir_all(&new_data).expect("mkdir new_data");
        std::fs::create_dir_all(&legacy).expect("mkdir legacy");
        std::fs::write(legacy.join("rss.dev.db"), b"db-bytes").expect("write legacy db");
        std::fs::write(legacy.join("rss.dev.db-wal"), b"wal-bytes").expect("write legacy wal");

        let db_path = new_data.join("rss.dev.db");
        migrate_legacy_shared_db(&new_data, &new_local, &db_path, "rss.dev.db");
        assert_eq!(std::fs::read(&db_path).unwrap(), b"db-bytes");
        assert_eq!(std::fs::read(with_suffix(&db_path, "-wal")).unwrap(), b"wal-bytes");
        assert!(legacy.join("rss.dev.db.migrated").is_file(), "legacy 改名 .migrated");

        // 目标已存在 → no-op；用户删库重置后也不得从 legacy 复活。
        std::fs::remove_file(&db_path).expect("remove migrated db");
        migrate_legacy_shared_db(&new_data, &new_local, &db_path, "rss.dev.db");
        assert!(!db_path.exists(), "删库重置后不得从 legacy 复活");

        // rss.db 属于正式版身份，绝不迁移。
        let prod = new_data.join("rss.db");
        std::fs::write(legacy.join("rss.db"), b"prod").expect("write prod db");
        migrate_legacy_shared_db(&new_data, &new_local, &prod, "rss.db");
        assert!(!prod.exists(), "rss.db 不得被迁移");

        // 防护①：旧目录服务开着**别的库**（安装版 rss.db）→ dev 库照常迁移。
        std::fs::create_dir_all(&legacy_service).expect("mkdir service");
        // Windows 路径含反斜杠，手拼 JSON 会转义坏 —— 一律走 serde。
        let endpoint_json = |db: &Path| {
            serde_json::json!({
                "schema": "amoeba-service/1",
                "dbFile": db.to_string_lossy(),
            })
            .to_string()
        };
        let legacy_prod = legacy.join("rss.db");
        std::fs::write(&legacy_service.join("endpoint.json"), endpoint_json(&legacy_prod))
            .expect("write endpoint");
        let legacy2 = legacy.join("rss.release-debug.db");
        std::fs::write(&legacy2, b"rel").expect("write legacy release-debug");
        let target2 = new_data.join("rss.release-debug.db");
        migrate_legacy_shared_db(&new_data, &new_local, &target2, "rss.release-debug.db");
        assert!(target2.is_file(), "安装版开着 rss.db 不阻塞 dev 库迁移");

        // 防护②：旧服务正持有待迁移库（endpoint 的 dbFile 命中源）→ 推迟。
        let legacy3 = legacy.join("rss.defer.db");
        std::fs::write(&legacy3, b"x").expect("write defer source");
        std::fs::write(&legacy_service.join("endpoint.json"), endpoint_json(&legacy3))
            .expect("write endpoint");
        let target3 = new_data.join("rss.defer.db");
        migrate_legacy_shared_db(&new_data, &new_local, &target3, "rss.defer.db");
        assert!(!target3.exists(), "旧服务持有时必须推迟迁移");

        // 防护③：endpoint 不可读 + instance.lock 的 pid 活着（服务启动中）→ 保守推迟。
        std::fs::remove_file(&legacy_service.join("endpoint.json")).expect("remove endpoint");
        std::fs::write(
            &legacy_service.join("instance.lock"),
            format!("{{\"pid\":{}}}", std::process::id()),
        )
        .expect("write lock");
        migrate_legacy_shared_db(&new_data, &new_local, &target3, "rss.defer.db");
        assert!(!target3.exists(), "锁活着且 endpoint 不可读时必须推迟");

        std::fs::remove_dir_all(&base).ok();
    }
}

#[tauri::command]
pub async fn service_endpoint(
    app: AppHandle,
    state: tauri::State<'_, ServiceState>,
    db_file: String,
) -> Result<Value, String> {
    // 快速路径：本进程已经拉起/采纳过，且服务还活着。
    let cached = {
        let inner = state.inner.lock().map_err(|_| "service state poisoned")?;
        inner.endpoint.clone()
    };
    if let Some(endpoint) = cached {
        let probe = endpoint.clone();
        let alive = tauri::async_runtime::spawn_blocking(move || health_ok(&probe))
            .await
            .unwrap_or(false);
        if alive {
            return Ok(endpoint);
        }
    }

    let paths = resolve_paths(&app, &db_file)?;
    let stderr_tail = {
        let inner = state.inner.lock().map_err(|_| "service state poisoned")?;
        Arc::clone(&inner.stderr_tail)
    };

    let (endpoint, child, owner_token) =
        tauri::async_runtime::spawn_blocking(move || ensure_service(&paths, stderr_tail))
            .await
            .map_err(|e| format!("service task failed: {e}"))??;

    let mut inner = state.inner.lock().map_err(|_| "service state poisoned")?;
    inner.endpoint = Some(endpoint.clone());
    if child.is_some() {
        inner.owned = child;
        inner.owner_token = owner_token;
    }
    Ok(endpoint)
}
