pub mod commands;
pub mod plugins;
/// 抓取浏览器 = Tauri 自己的 WebView2（本分支已替换 spawn 系统 Edge 的方案）。
pub mod webview_browser;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = plugins::configure(tauri::Builder::default())
        // WS 隧道连接管理(state):弹幕长连接按 connectionId 定位发/关。
        // Arc 包裹供 reader task clone 持引用(跨 command 共享)。
        .manage(std::sync::Arc::new(commands::ws::WsManager::default()))
        .setup(|app| {
            // 本分支默认就用 WebView2 当抓取浏览器：启动时先建好（隐藏），免得第一次
            // 抓取才付创建成本；空闲回收关掉后由 webview_browser_open 重建。
            #[cfg(windows)]
            match webview_browser::open_at_setup(app.handle()) {
                Ok(port) => eprintln!("[browser] webview cdp on {port}"),
                Err(e) => eprintln!("[browser] webview open failed: {e}"),
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::http_get,
            commands::ws::ws_connect,
            commands::ws::ws_send,
            commands::ws::ws_close,
            commands::webview_browser::webview_browser_open,
            commands::webview_browser::webview_browser_set_mode,
            commands::webview_browser::webview_browser_close,
            commands::webview_browser::webview_browser_reset,
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
            // 应用退出时关掉抓取 webview（RunEvent::Exit 在进程退出前确定触发）。
            if let tauri::RunEvent::Exit = event {
                eprintln!("[tauri] Exit event → webview close");
                #[cfg(windows)]
                let _ = webview_browser::close(app_handle);
            }
        });
    }
}
