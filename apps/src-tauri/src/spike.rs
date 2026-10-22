//! spike —— 一次性验证：用 Tauri 自己的 WebView2 当抓取浏览器（代替 spawn Edge）。
//!
//! 只在 `debug_assertions` + Windows 编译；启动时读环境变量 `SPIKE_WEBVIEW=1` 才生效。
//! 目的：量三件事 —— ① WebView2 的 CDP 端口能不能像 Edge 一样驱动；
//! ② 页面里是否出现 `window.chrome.webview` 这个嵌入标识；
//! ③ 同样的 xhs 首屏下 private 内存比 Edge（~990MB）低多少。
//!
//! ⚠️ `additional_browser_args` 会**覆盖** Tauri 默认带的
//! `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`，这里必须自己补回。
//! ⚠️ 参数不同的 webview 必须配独立 `data_directory`（Tauri 文档要求），
//! 否则会并进应用主界面那个 WebView2 环境，调试端口也会暴露给主界面。

use std::path::PathBuf;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// 与 Edge 的 9223 错开，避免和正式抓取实例打架。
pub const SPIKE_PORT: u16 = 9334;

const LABEL: &str = "spike-webview";

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("spike-webview"))
}

fn browser_args() -> String {
    // 与 edge_args 对齐的抓取参数；区别只是没有 Edge UI 那一层。
    [
        format!("--remote-debugging-port={SPIKE_PORT}"),
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
        // Tauri/wry 默认的这三项被覆盖后必须补回，另加产品用的 feature 关闭项。
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
        "--window-position=-32000,-32000".to_string(),
    ]
    .join(" ")
}

/// 建一个隐藏的抓取 webview（独立 profile + CDP 端口），返回端口。
pub fn open(app: &AppHandle) -> Result<u16, String> {
    let dir = data_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let url = tauri::Url::parse("about:blank").map_err(|e| e.to_string())?;

    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External(url))
        .title("spike-webview")
        // 试把 UA 改成普通 Edge（WebView2 默认 UA 其实已经是 Edg/155，但 UA-CH 的
        // brands 里带 "Microsoft Edge WebView2/155"，这里验证改 UA 会不会连带改 UA-CH）。
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) \
             Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0",
        )
        .visible(false)
        .skip_taskbar(true)
        .decorations(false)
        .inner_size(1280.0, 800.0)
        .data_directory(dir)
        .additional_browser_args(&browser_args())
        .build()
        .map_err(|e| e.to_string())?;

    Ok(SPIKE_PORT)
}
