//! webview_browser —— 用 Tauri 自己的 WebView2 当抓取浏览器（**本分支的默认方案**）。
//!
//! 与 `commands::browser`（spawn 系统 Edge）的关系：本分支把抓取浏览器整体换成这里 ——
//! 一个隐藏的 `WebviewWindow`（独立 `data_directory`）+ CDP 端口 9334。TS 侧的
//! `TauriBrowserBackend` 仍是同一套 CDP 客户端，只是端口来源换成 `webview_browser_open`。
//!
//! 为什么能省内存：Edge 实例自带 Copilot / discover-chat / nurturing 等界面
//! （实测 private ~0.29GB），WebView2 没有这一层；代价是页面里能直接读到
//! `window.chrome.webview` 与 UA-CH 的 `Microsoft Edge WebView2`（见 crawler-topology）。
//!
//! ⚠️ WebView2 的窗口创建必须在主线程：命令跑在线程池，统一经 `run_on_main_thread`
//! 回主线程并等结果（`build_on_main`）。
//! ⚠️ `additional_browser_args` 会**覆盖** wry 默认带的
//! `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`，这里自己补回。

#[cfg(windows)]
use std::path::PathBuf;
#[cfg(windows)]
use std::time::Duration;
#[cfg(windows)]
use tauri::{AppHandle, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};
#[cfg(not(windows))]
use tauri::AppHandle;

/// 与正式 Edge 的 9223 不同：本分支不再 spawn Edge，这个端口只服务 WebView2。
pub const PORT: u16 = 9334;

#[cfg(windows)]
const LABEL: &str = "scrape-webview";

#[cfg(windows)]
fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("webview-profile"))
}

fn browser_args() -> String {
    [
        format!("--remote-debugging-port={PORT}"),
        "--remote-allow-origins=*".to_string(),
        "--no-first-run".to_string(),
        "--no-default-browser-check".to_string(),
        "--hide-crash-restore-bubble".to_string(),
        "--disable-sync".to_string(),
        "--disable-extensions".to_string(),
        "--disable-default-apps".to_string(),
        "--disable-background-timer-throttling".to_string(),
        "--disable-renderer-backgrounding".to_string(),
        "--disable-backgrounding-occluded-windows".to_string(),
        // Tauri/wry 的默认项被覆盖后必须补回，另加产品用的 feature 关闭项。
        "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion,Translate,BackForwardCache,OptimizationHints,MediaRouter".to_string(),
        "--disable-background-networking".to_string(),
        "--disable-component-update".to_string(),
        "--no-pings".to_string(),
        "--disable-breakpad".to_string(),
        "--metrics-recording-only".to_string(),
        "--disable-gpu-compositing".to_string(),
        "--js-flags=--max-old-space-size=512".to_string(),
        "--disk-cache-size=67108864".to_string(),
        "--blink-settings=imagesEnabled=false".to_string(),
        // 屏外起点：interactive 模式 show 出来也不会闪到用户屏幕正中。
        "--window-position=-32000,-32000".to_string(),
    ]
    .join(" ")
}

/// 真正建 webview（只能在主线程调用）。
fn build(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window(LABEL).is_some() {
        return Ok(());
    }
    let dir = data_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let url = tauri::Url::parse("about:blank").map_err(|e| e.to_string())?;

    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External(url))
        .title(LABEL)
        .visible(false)
        .skip_taskbar(true)
        .decorations(false)
        .inner_size(1280.0, 800.0)
        .data_directory(dir)
        .additional_browser_args(&browser_args())
        .build()
        .map_err(|e| format!("创建抓取 webview 失败: {e}"))?;
    Ok(())
}

/// 命令跑在线程池 → 回主线程建 webview，等结果。
fn build_on_main(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window(LABEL).is_some() {
        return Ok(());
    }
    let (tx, rx) = std::sync::mpsc::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = tx.send(build(&handle));
    })
    .map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(15))
        .map_err(|e| format!("创建抓取 webview 超时: {e}"))?
}

/// 确保 webview 存在，返回 CDP 端口（幂等）。
pub fn open(app: &AppHandle) -> Result<u16, String> {
    build_on_main(app)?;
    Ok(PORT)
}

/// setup 阶段专用：此时已在主线程、事件循环还没起来，`run_on_main_thread` 会死等。
pub fn open_at_setup(app: &AppHandle) -> Result<u16, String> {
    build(app)?;
    Ok(PORT)
}

/// 窗口模式：hidden = 藏窗口；interactive = 屏外显示（渲染/滚动照常）。
pub fn set_mode(app: &AppHandle, mode: &str) -> Result<(), String> {
    let visible = match mode {
        "hidden" => false,
        "interactive" => true,
        other => return Err(format!("未知窗口模式: {other}（可用: hidden / interactive）")),
    };
    build_on_main(app)?;
    let win = app
        .get_webview_window(LABEL)
        .ok_or_else(|| "抓取 webview 不存在".to_string())?;
    if visible {
        // 先定位再显示，避免在默认位置闪一下。
        let _ = win.set_position(PhysicalPosition::new(-32000, -32000));
        win.show().map_err(|e| e.to_string())
    } else {
        win.hide().map_err(|e| e.to_string())
    }
}

/// 关闭 webview（空闲回收 / 应用退出）。下次 `open` 会重建。
pub fn close(app: &AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(LABEL) {
        win.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 清空抓取 profile（登录态/缓存）：先关 webview，再删目录（Windows 可能短暂占用 → 重试）。
pub fn reset(app: &AppHandle) -> Result<String, String> {
    let dir = data_dir(app)?;
    close(app)?;
    let mut last = String::new();
    for _ in 0..30 {
        if !dir.exists() {
            return Ok(format!("已清空抓取浏览器数据（{}）", dir.display()));
        }
        match std::fs::remove_dir_all(&dir) {
            Ok(()) => return Ok("已清空抓取浏览器数据，下次使用会重建".to_string()),
            Err(e) => {
                last = e.to_string();
                std::thread::sleep(Duration::from_millis(200));
            }
        }
    }
    Err(format!("删除抓取 profile 失败（{}）：{last}", dir.display()))
}

// ── 非 Windows：抓取浏览器只支持 Windows（与「移动端无 CDP」的既有结论一致） ──────

#[cfg(not(windows))]
pub fn open(_app: &AppHandle) -> Result<u16, String> {
    Err("抓取浏览器仅 Windows 可用".to_string())
}

#[cfg(not(windows))]
pub fn open_at_setup(_app: &AppHandle) -> Result<u16, String> {
    Err("抓取浏览器仅 Windows 可用".to_string())
}

#[cfg(not(windows))]
pub fn set_mode(_app: &AppHandle, _mode: &str) -> Result<(), String> {
    Err("抓取浏览器仅 Windows 可用".to_string())
}

#[cfg(not(windows))]
pub fn close(_app: &AppHandle) -> Result<(), String> {
    Ok(())
}

#[cfg(not(windows))]
pub fn reset(_app: &AppHandle) -> Result<String, String> {
    Err("抓取浏览器仅 Windows 可用".to_string())
}
