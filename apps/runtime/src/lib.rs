//! Bun 运行时解析/下载（`amoeba-runtime` 的核心）。
//!
//! 启动器自己是 Rust，所以「机器上没有 Bun」时仍能下载 Bun：
//!
//! ```text
//! AMOEBA_BUN 显式路径
//!   → PATH 里的 bun（1.3 ≤ v < 2）
//!   → 随包 bun（可选，离线发行版）
//!   → 托管缓存 %LOCALAPPDATA%\app.amoeba.runtime\bun-<版本>\bun.exe
//!   → 下载固定版本 → SHA256 → 解压到缓存
//! ```
//!
//! 约束：
//! - 日志只走 stderr；stdout 留给被拉起的服务（`READY <port>`）。
//! - `AMOEBA_BUN` 是显式覆盖，配错直接报错，不静默改道。
//! - 下载只解压固定成员，先写 `.tmp` 再同卷 rename；校验失败不落盘。
//! - v1 只自动下载 Windows x64；其他平台要求已有 Bun。

use std::env;
use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{self, ErrorKind, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};
use zip::ZipArchive;

pub const PINNED_BUN_VERSION: &str = "1.4.3";
pub const MIN_BUN_VERSION: &str = "1.3.0";
/// `bun-windows-x64.zip`（44,639,930 bytes）的 SHA256；升级版本时同步改这里。
pub const PINNED_BUN_SHA256: &str =
    "0bf84e808552beea67bf1202a287a35c6c825d837b287b3f8e9dd513dba35d3d";

const DOWNLOAD_URL: &str =
    "https://github.com/oven-sh/bun/releases/download/bun-v1.4.3/bun-windows-x64.zip";
const ZIP_MEMBER: &str = "bun-windows-x64/bun.exe";
const MAX_DOWNLOAD_BYTES: u64 = 120 * 1024 * 1024;
const VERSION_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug)]
pub struct RuntimeError(String);

impl RuntimeError {
    pub fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

impl fmt::Display for RuntimeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for RuntimeError {}

impl From<io::Error> for RuntimeError {
    fn from(e: io::Error) -> Self {
        Self(format!("I/O: {e}"))
    }
}

impl From<reqwest::Error> for RuntimeError {
    fn from(e: reqwest::Error) -> Self {
        Self(format!("HTTP: {e}"))
    }
}

impl From<zip::result::ZipError> for RuntimeError {
    fn from(e: zip::result::ZipError) -> Self {
        Self(format!("zip: {e}"))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeSource {
    Env,
    Path,
    Bundled,
    Cache,
    Downloaded,
}

impl fmt::Display for RuntimeSource {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Env => "AMOEBA_BUN",
            Self::Path => "PATH",
            Self::Bundled => "bundled",
            Self::Cache => "cache",
            Self::Downloaded => "download",
        })
    }
}

#[derive(Debug, Clone)]
pub struct BunRuntime {
    pub path: PathBuf,
    pub version: BunVersion,
    pub source: RuntimeSource,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct BunVersion {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
}

impl fmt::Display for BunVersion {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}.{}.{}", self.major, self.minor, self.patch)
    }
}

#[derive(Debug, Clone, Copy)]
pub struct ResolveOptions {
    /// 允许联网下载；`--no-download` / 离线模式置 false。
    pub allow_download: bool,
    /// 解析/下载过程写 stderr。
    pub log: bool,
}

impl Default for ResolveOptions {
    fn default() -> Self {
        Self {
            allow_download: true,
            log: true,
        }
    }
}

fn info(opts: &ResolveOptions, message: impl AsRef<str>) {
    if opts.log {
        eprintln!("[runtime] {}", message.as_ref());
    }
}

pub fn exe_name() -> &'static str {
    if cfg!(windows) {
        "bun.exe"
    } else {
        "bun"
    }
}

fn env_nonempty(name: &str) -> Option<String> {
    env::var_os(name).and_then(|v| {
        let s = v.to_string_lossy().trim().to_string();
        (!s.is_empty()).then_some(s)
    })
}

pub fn parse_version(raw: &str) -> Option<BunVersion> {
    let core = raw.trim().trim_start_matches('v');
    let core = core.split(['-', '+']).next()?;
    let mut parts = core.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next()?.parse().ok()?;
    Some(BunVersion {
        major,
        minor,
        patch,
    })
}

pub fn is_supported(version: &BunVersion) -> bool {
    let min = parse_version(MIN_BUN_VERSION).expect("MIN_BUN_VERSION 必须是 x.y.z");
    version.major == 1 && *version >= min
}

pub fn is_pinned(version: &BunVersion) -> bool {
    parse_version(PINNED_BUN_VERSION).as_ref() == Some(version)
}

/// 启动 `bun --version` 并解析；超时会杀掉子进程。
pub fn read_version(path: &Path) -> Result<BunVersion, RuntimeError> {
    let mut child = Command::new(path)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| RuntimeError::new(format!("无法执行 {}: {e}", path.display())))?;

    let mut stdout = child.stdout.take().expect("stdout piped");
    let mut stderr = child.stderr.take().expect("stderr piped");
    let out_thread = thread::spawn(move || {
        let mut s = String::new();
        let _ = stdout.read_to_string(&mut s);
        s
    });
    let err_thread = thread::spawn(move || {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s);
        s
    });

    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => {
                if started.elapsed() > VERSION_TIMEOUT {
                    let _ = child.kill();
                    break None;
                }
                thread::sleep(Duration::from_millis(20));
            }
            Err(e) => {
                return Err(RuntimeError::new(format!(
                    "等待 {} 失败: {e}",
                    path.display()
                )))
            }
        }
    };

    let stdout = out_thread.join().unwrap_or_default();
    let stderr = err_thread.join().unwrap_or_default();
    let Some(status) = status else {
        return Err(RuntimeError::new(format!(
            "{} --version 超过 {}s 未返回（已终止）",
            path.display(),
            VERSION_TIMEOUT.as_secs()
        )));
    };
    if !status.success() {
        let detail = stderr.trim();
        return Err(RuntimeError::new(format!(
            "{} --version 退出码 {:?}{}",
            path.display(),
            status.code(),
            if detail.is_empty() {
                String::new()
            } else {
                format!("：{detail}")
            }
        )));
    }

    let raw = stdout
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("");
    parse_version(raw).ok_or_else(|| {
        RuntimeError::new(format!(
            "{} --version 输出无法解析：{:?}",
            path.display(),
            raw
        ))
    })
}

pub fn cache_root() -> Result<PathBuf, RuntimeError> {
    if let Some(dir) = env_nonempty("AMOEBA_RUNTIME_DIR") {
        return Ok(PathBuf::from(dir));
    }
    #[cfg(windows)]
    {
        if let Some(dir) = env_nonempty("LOCALAPPDATA") {
            return Ok(PathBuf::from(dir).join("app.amoeba.runtime"));
        }
        Err(RuntimeError::new(
            "LOCALAPPDATA 未设置；无法确定 Bun 缓存目录（可用 AMOEBA_RUNTIME_DIR 覆盖）",
        ))
    }
    #[cfg(not(windows))]
    {
        if let Some(dir) = env_nonempty("XDG_CACHE_HOME") {
            return Ok(PathBuf::from(dir).join("app.amoeba.runtime"));
        }
        if let Some(dir) = env_nonempty("HOME") {
            return Ok(PathBuf::from(dir).join(".cache").join("app.amoeba.runtime"));
        }
        Err(RuntimeError::new(
            "无法确定缓存目录；请设置 AMOEBA_RUNTIME_DIR",
        ))
    }
}

pub fn cached_bun_path() -> Result<PathBuf, RuntimeError> {
    Ok(cache_root()?
        .join(format!("bun-{PINNED_BUN_VERSION}"))
        .join(exe_name()))
}

/// 按「全局优先、失败自动下载」解析 Bun。
pub fn ensure_bun(opts: &ResolveOptions) -> Result<BunRuntime, RuntimeError> {
    // 1. 显式覆盖：配错直接报错，避免静默跑到别的 Bun。
    if let Some(raw) = env_nonempty("AMOEBA_BUN") {
        let path = PathBuf::from(&raw);
        if !path.is_file() {
            return Err(RuntimeError::new(format!(
                "AMOEBA_BUN 指向的文件不存在：{raw}"
            )));
        }
        let version = read_version(&path)
            .map_err(|e| RuntimeError::new(format!("AMOEBA_BUN={raw} 不可用：{e}")))?;
        if !is_supported(&version) {
            return Err(RuntimeError::new(format!(
                "AMOEBA_BUN 版本 {version} 不受支持（需要 1.3 ≤ v < 2）：{raw}"
            )));
        }
        if !is_pinned(&version) {
            info(
                opts,
                format!("AMOEBA_BUN 版本 {version} 与验证版本 {PINNED_BUN_VERSION} 不同，继续使用"),
            );
        }
        return Ok(BunRuntime {
            path,
            version,
            source: RuntimeSource::Env,
        });
    }

    // 2. 全局 PATH（用户选择的优先来源）。
    if let Some(runtime) = find_on_path(opts) {
        info(
            opts,
            format!(
                "使用全局 Bun {}（{}）",
                runtime.version,
                runtime.path.display()
            ),
        );
        return Ok(runtime);
    }

    // 3. 随包（可选；默认发行版不带）。
    if let Some(runtime) = find_bundled(opts) {
        info(
            opts,
            format!(
                "使用随包 Bun {}（{}）",
                runtime.version,
                runtime.path.display()
            ),
        );
        return Ok(runtime);
    }

    // 4. 托管缓存。
    let cached = cached_bun_path()?;
    if cached.is_file() {
        match read_version(&cached) {
            Ok(version) if is_pinned(&version) => {
                info(
                    opts,
                    format!("使用缓存 Bun {}（{}）", version, cached.display()),
                );
                return Ok(BunRuntime {
                    path: cached,
                    version,
                    source: RuntimeSource::Cache,
                });
            }
            Ok(version) => info(
                opts,
                format!(
                    "缓存 Bun 版本 {version} 不是 {PINNED_BUN_VERSION}，重新安装：{}",
                    cached.display()
                ),
            ),
            Err(e) => info(
                opts,
                format!("缓存 Bun 不可用（{e}），重新安装：{}", cached.display()),
            ),
        }
    }

    // 5. 下载。
    if !opts.allow_download {
        return Err(RuntimeError::new(
            "未找到可用的 Bun（需要 1.3 ≤ v < 2）。已禁用自动下载；\
             请安装 Bun、设置 AMOEBA_BUN，或去掉 --no-download",
        ));
    }

    let installed = install_pinned(opts, &cached)?;
    let version = read_version(&cached)
        .map_err(|e| RuntimeError::new(format!("安装后的 Bun 无法运行：{e}")))?;
    if !is_pinned(&version) {
        return Err(RuntimeError::new(format!(
            "安装后的 Bun 版本 {version} 不是 {PINNED_BUN_VERSION}：{}",
            cached.display()
        )));
    }
    let source = if installed {
        info(
            opts,
            format!("已安装 Bun {}（{}）", version, cached.display()),
        );
        RuntimeSource::Downloaded
    } else {
        info(
            opts,
            format!("使用缓存 Bun {}（{}）", version, cached.display()),
        );
        RuntimeSource::Cache
    };
    Ok(BunRuntime {
        path: cached,
        version,
        source,
    })
}

fn find_on_path(opts: &ResolveOptions) -> Option<BunRuntime> {
    let path = env::var_os("PATH")?;
    for dir in env::split_paths(&path) {
        // 只接受绝对路径；相对路径等价于从当前目录加载，风险不可控。
        if dir.as_os_str().is_empty() || dir.is_relative() {
            continue;
        }
        let candidate = dir.join(exe_name());
        if !candidate.is_file() {
            continue;
        }
        match read_version(&candidate) {
            Ok(version) if is_supported(&version) => {
                if !is_pinned(&version) {
                    info(
                        opts,
                        format!(
                            "PATH 上的 Bun {version} 与验证版本 {PINNED_BUN_VERSION} 不同，继续使用：{}",
                            candidate.display()
                        ),
                    );
                }
                return Some(BunRuntime {
                    path: candidate,
                    version,
                    source: RuntimeSource::Path,
                });
            }
            Ok(version) => info(
                opts,
                format!(
                    "跳过 PATH 上的 Bun {version}（需要 1.3 ≤ v < 2）：{}",
                    candidate.display()
                ),
            ),
            Err(e) => info(opts, format!("跳过 PATH 上的 {}：{e}", candidate.display())),
        }
    }
    None
}

fn find_bundled(opts: &ResolveOptions) -> Option<BunRuntime> {
    let exe = env::current_exe().ok()?;
    let dir = exe.parent()?;
    for rel in [exe_name(), "runtime/bun.exe", "resources/bun.exe"] {
        let candidate = dir.join(rel);
        if !candidate.is_file() {
            continue;
        }
        match read_version(&candidate) {
            Ok(version) if is_supported(&version) => {
                return Some(BunRuntime {
                    path: candidate,
                    version,
                    source: RuntimeSource::Bundled,
                });
            }
            Ok(version) => info(
                opts,
                format!(
                    "跳过随包 Bun {version}（需要 1.3 ≤ v < 2）：{}",
                    candidate.display()
                ),
            ),
            Err(e) => info(opts, format!("跳过随包 {}：{e}", candidate.display())),
        }
    }
    None
}

struct InstallLock {
    path: PathBuf,
}

impl Drop for InstallLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

/// 首次启动可能有两个客户端同时下载/解压；串行化并允许 stale 锁回收。
fn acquire_install_lock(root: &Path) -> Result<InstallLock, RuntimeError> {
    const WAIT: Duration = Duration::from_secs(120);
    const STALE: Duration = Duration::from_secs(300);
    let path = root.join("install.lock");
    let started = Instant::now();
    loop {
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                let _ = writeln!(file, "pid={}", std::process::id());
                return Ok(InstallLock { path });
            }
            Err(e) if e.kind() == ErrorKind::AlreadyExists => {
                let stale = fs::metadata(&path)
                    .and_then(|m| m.modified())
                    .ok()
                    .and_then(|t| t.elapsed().ok())
                    .is_some_and(|age| age > STALE);
                if stale {
                    let _ = fs::remove_file(&path);
                    continue;
                }
                if started.elapsed() > WAIT {
                    return Err(RuntimeError::new(format!(
                        "等待 Bun 安装锁超时（{}）：{}",
                        WAIT.as_secs(),
                        path.display()
                    )));
                }
                thread::sleep(Duration::from_millis(200));
            }
            Err(e) => {
                return Err(RuntimeError::new(format!(
                    "无法创建安装锁 {}：{e}",
                    path.display()
                )));
            }
        }
    }
}

/// 返回 true 表示本次真正写入了 Bun；false 表示等锁期间别的进程已装好。
fn install_pinned(opts: &ResolveOptions, target: &Path) -> Result<bool, RuntimeError> {
    if !cfg!(windows) {
        return Err(RuntimeError::new(
            "自动下载/安装 Bun 目前仅支持 Windows x64；请安装 Bun 或设置 AMOEBA_BUN",
        ));
    }

    let root = cache_root()?;
    fs::create_dir_all(&root)?;
    let _lock = acquire_install_lock(&root)?;

    // 等锁期间另一个进程可能已经装好；二次检查，避免重复下载/覆盖。
    if target.is_file() {
        if let Ok(version) = read_version(target) {
            if is_pinned(&version) {
                info(
                    opts,
                    format!("另一个进程已安装 Bun {}（{}）", version, target.display()),
                );
                return Ok(false);
            }
        }
    }

    let downloads = root.join("downloads");
    fs::create_dir_all(&downloads)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }

    // 本地 zip：离线/CI 测试用，仍走同一套校验和解压。
    if let Some(local) = env_nonempty("AMOEBA_BUN_ZIP") {
        let local = PathBuf::from(local);
        if !local.is_file() {
            return Err(RuntimeError::new(format!(
                "AMOEBA_BUN_ZIP 指向的文件不存在：{}",
                local.display()
            )));
        }
        info(opts, format!("使用本地 zip：{}", local.display()));
        verify_sha256(&local, PINNED_BUN_SHA256)?;
        extract_bun(&local, target)?;
        return Ok(true);
    }

    let tmp = downloads.join(format!(
        "bun-{PINNED_BUN_VERSION}-{}.zip.part",
        std::process::id()
    ));
    let result = (|| {
        info(
            opts,
            format!("未找到 Bun，下载 {PINNED_BUN_VERSION}（约 43MB）..."),
        );
        download_to(&tmp, DOWNLOAD_URL, opts)?;
        verify_sha256(&tmp, PINNED_BUN_SHA256)?;
        extract_bun(&tmp, target)?;
        Ok(true)
    })();
    let _ = fs::remove_file(&tmp);
    result
}

fn download_to(dest: &Path, url: &str, opts: &ResolveOptions) -> Result<(), RuntimeError> {
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(900))
        .user_agent(format!("amoeba-runtime/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| RuntimeError::new(format!("创建 HTTP 客户端失败：{e}")))?;
    let mut response = client
        .get(url)
        .send()
        .map_err(|e| RuntimeError::new(format!("下载失败：{e}")))?;
    if !response.status().is_success() {
        return Err(RuntimeError::new(format!(
            "下载失败：HTTP {} {url}",
            response.status()
        )));
    }

    let total = response.content_length();
    let mut file = File::create(dest)?;
    let mut buf = [0u8; 64 * 1024];
    let mut read: u64 = 0;
    let mut last_report = 0u64;
    loop {
        let n = response
            .read(&mut buf)
            .map_err(|e| RuntimeError::new(format!("读取下载流失败：{e}")))?;
        if n == 0 {
            break;
        }
        read += n as u64;
        if read > MAX_DOWNLOAD_BYTES {
            return Err(RuntimeError::new(format!(
                "下载超过上限 {} MB，已中止",
                MAX_DOWNLOAD_BYTES / 1024 / 1024
            )));
        }
        file.write_all(&buf[..n])?;
        if let Some(total) = total {
            let pct = (read * 100 / total.max(1)).min(100);
            if pct >= last_report + 25 {
                last_report = pct;
                info(
                    opts,
                    format!(
                        "下载 Bun {pct}%（{:.1}/{:.1} MB）",
                        read as f64 / 1_048_576.0,
                        total as f64 / 1_048_576.0
                    ),
                );
            }
        }
    }
    file.sync_all()?;
    Ok(())
}

fn verify_sha256(path: &Path, expected: &str) -> Result<(), RuntimeError> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let actual = to_hex(&hasher.finalize());
    if actual.eq_ignore_ascii_case(expected) {
        Ok(())
    } else {
        Err(RuntimeError::new(format!(
            "SHA256 校验失败（期望 {expected}，实际 {actual}）：{}",
            path.display()
        )))
    }
}

fn to_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

fn extract_bun(zip_path: &Path, target: &Path) -> Result<(), RuntimeError> {
    let file = File::open(zip_path)?;
    let mut archive = ZipArchive::new(file)?;
    let mut entry = archive.by_name(ZIP_MEMBER).map_err(|_| {
        RuntimeError::new(format!(
            "zip 缺少固定成员 {ZIP_MEMBER}：{}",
            zip_path.display()
        ))
    })?;
    if entry.size() > MAX_DOWNLOAD_BYTES {
        return Err(RuntimeError::new(format!(
            "zip 成员 {ZIP_MEMBER} 过大（{} bytes），拒绝解压",
            entry.size()
        )));
    }

    let name = target
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "bun.exe".to_string());
    let tmp = target.with_file_name(format!("{name}.tmp-{}", std::process::id()));

    let copied = (|| -> Result<(), RuntimeError> {
        let mut out = File::create(&tmp)?;
        io::copy(&mut entry, &mut out)?;
        out.sync_all()?;
        Ok(())
    })();
    if let Err(e) = copied {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    if target.exists() {
        fs::remove_file(target)?;
    }
    fs::rename(&tmp, target)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_release_versions() {
        assert_eq!(
            parse_version("1.4.3"),
            Some(BunVersion {
                major: 1,
                minor: 4,
                patch: 3
            })
        );
        assert_eq!(
            parse_version(" v1.4.3-canary.1\n"),
            Some(BunVersion {
                major: 1,
                minor: 4,
                patch: 3
            })
        );
        assert!(parse_version("1.4").is_none());
        assert!(parse_version("canary").is_none());
    }

    #[test]
    fn gates_supported_versions() {
        assert!(is_supported(&parse_version("1.3.0").unwrap()));
        assert!(is_supported(&parse_version("1.9.9").unwrap()));
        assert!(!is_supported(&parse_version("1.2.9").unwrap()));
        assert!(!is_supported(&parse_version("2.0.0").unwrap()));
        assert!(is_pinned(&parse_version(PINNED_BUN_VERSION).unwrap()));
    }

    #[test]
    fn hex_is_lowercase() {
        assert_eq!(to_hex(&[0x00, 0x0f, 0xa5, 0xff]), "000fa5ff");
    }
}
