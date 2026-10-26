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
        (
            res.join(exe_name("amoeba-runtime")),
            res.join("service").join("service.js"),
            Some(res.join(exe_name("amoeba-browser"))),
        )
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
        return Err(format!(
            "找不到运行时启动器：{}\n先运行 `cargo build -p amoeba-runtime`",
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

/// 主窗口销毁时调用（幂等）。
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
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(100)),
            _ => break,
        }
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
