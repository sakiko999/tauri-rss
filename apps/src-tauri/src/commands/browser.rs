//! browser — 浏览器模拟爬取支持(CDP 附加真实 Edge)。
//!
//! 微博/小红书反爬强,纯 HTTP/纯算法难以为继,需真实浏览器环境提供
//! 登录态 + JS 签名 + 设备指纹。本模块 spawn 系统 Edge(带
//! `--remote-debugging-port`),crawler 侧通过 appHost.ws 连 CDP 端点
//! (`ws://127.0.0.1:<port>/devtools/browser`)发 `Runtime.evaluate` 命令。
//!
//! 为什么不打包浏览器:真实 Edge 零打包体积、真实指纹(反检测最强,
//! 2026 风控识别不了)、`--user-data-dir` 持久化登录态(扫码一次后续复用)。
//! 与 sidecar(打包 Chromium,~150MB,无 stealth)相比是生产首选。

use std::net::TcpStream;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// 浏览器进程管理:持有 spawn 的 Edge 子进程,供 browser_close kill。
pub struct BrowserManager {
    child: Mutex<Option<std::process::Child>>,
}

impl Default for BrowserManager {
    fn default() -> Self {
        Self { child: Mutex::new(None) }
    }
}

/// CDP 固定端口(高位,避开常见服务端口)。
const CDP_PORT: u16 = 9223;

/// 探测端口上是否已有 CDP 服务(Edge 已启动则复用,避免重复 spawn)。
fn cdp_alive(port: u16) -> bool {
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(300)).is_ok()
}

/// 探测系统 Edge 可执行路径(Windows 常见安装位置)。
fn edge_path() -> Option<std::path::PathBuf> {
    const CANDIDATES: [&str; 2] = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ];
    for p in CANDIDATES {
        let pb = std::path::PathBuf::from(p);
        if pb.exists() {
            return Some(pb);
        }
    }
    None
}

/// 确保浏览器就绪,返回 CDP 端口。
///
/// 幂等:端口上已有 CDP 服务(之前 spawn 的 Edge 存活)则直接复用。
/// 否则 spawn 系统 Edge(--remote-debugging-port + --user-data-dir 持久化登录态)。
#[tauri::command]
pub fn browser_ensure(app: AppHandle) -> Result<u16, String> {
    let port = CDP_PORT;
    if cdp_alive(port) {
        return Ok(port);
    }

    let path = edge_path().ok_or("未找到系统 Edge,浏览器模拟不可用".to_string())?;

    // user-data-dir 持久化登录态(首次扫码登录后后续复用;独立 profile 不接管用户 Edge)。
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("edge-profile");
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

    let child = std::process::Command::new(&path)
        .arg(format!("--remote-debugging-port={port}"))
        .arg(format!("--user-data-dir={}", data_dir.display()))
        // 新 Chromium 拒跨源 CDP,必须放开 origin。
        .arg("--remote-allow-origins=*")
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        .arg("about:blank")
        .spawn()
        .map_err(|e| format!("spawn Edge 失败: {e}"))?;

    // 保存子进程供 browser_close kill。
    let manager = app.state::<BrowserManager>();
    *manager.child.lock().unwrap() = Some(child);

    // 等待 CDP 就绪(最多 ~3s;阻塞调用,command 非 async 故在 command 线程)。
    for _ in 0..30 {
        if cdp_alive(port) {
            return Ok(port);
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    Err("Edge 已启动但 CDP 未就绪".to_string())
}

/// 关闭浏览器进程(应用退出时调用,避免残留 Edge)。
#[tauri::command]
pub fn browser_close(app: AppHandle) -> Result<(), String> {
    let manager = app.state::<BrowserManager>();
    let mut guard = manager.child.lock().unwrap();
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}
