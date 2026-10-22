pub mod commands;
pub mod plugins;
/// 一次性 spike：WebView2 当抓取浏览器（仅 Windows + debug，`SPIKE_WEBVIEW=1` 触发）。
#[cfg(all(windows, debug_assertions))]
pub mod spike;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = plugins::configure(tauri::Builder::default())
        // WS 隧道连接管理(state):弹幕长连接按 connectionId 定位发/关。
        // Arc 包裹供 reader task clone 持引用(跨 command 共享)。
        .manage(std::sync::Arc::new(commands::ws::WsManager::default()))
        .manage(commands::browser::BrowserManager::default())
        .setup(|app| {
            #[cfg(all(windows, debug_assertions))]
            if std::env::var_os("SPIKE_WEBVIEW").is_some() {
                match spike::open(app.handle()) {
                    Ok(port) => eprintln!("[spike] webview cdp on {port}"),
                    Err(e) => eprintln!("[spike] open failed: {e}"),
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::http_get,
            commands::ws::ws_connect,
            commands::ws::ws_send,
            commands::ws::ws_close,
            commands::browser::browser_ensure,
            commands::browser::browser_set_mode,
            commands::browser::browser_close,
            commands::browser::browser_reset_profile,
        ]);

    #[cfg(mobile)]
    builder
        .run(tauri::generate_context!("tauri.conf.mobile.json"))
        .expect("error while running tauri application");

    #[cfg(not(mobile))]
    {
        let app = builder
            .build(tauri::generate_context!())
            .expect("error while running tauri application");
        app.run(|app_handle, event| {
            // 应用退出时清理浏览器模拟 Edge(RunEvent::Exit 在进程退出前确定触发,
            // 不依赖 WebView JS 存活)。终止主进程 → Chromium Job Object 连带杀子进程。
            if let tauri::RunEvent::Exit = event {
                eprintln!("[tauri] Exit event → browser_close");
                let _ = commands::browser::browser_close(app_handle.clone());
            }
        });
    }
}
