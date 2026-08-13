pub mod commands;
pub mod plugins;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = plugins::configure(tauri::Builder::default())
        // WS 隧道连接管理(state):弹幕长连接按 connectionId 定位发/关。
        // Arc 包裹供 reader task clone 持引用(跨 command 共享)。
        .manage(std::sync::Arc::new(commands::ws::WsManager::default()))
        .invoke_handler(tauri::generate_handler![
            commands::http_get,
            commands::ws::ws_connect,
            commands::ws::ws_send,
            commands::ws::ws_close,
        ]);

    #[cfg(mobile)]
    builder
        .run(tauri::generate_context!("tauri.conf.mobile.json"))
        .expect("error while running tauri application");

    #[cfg(not(mobile))]
    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
