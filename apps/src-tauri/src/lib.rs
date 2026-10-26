use tauri::Manager;

pub mod commands;
/// 防盗链 Referer 注入(仅 Windows/WebView2；其他平台静默不注册)。
#[cfg(windows)]
pub mod media_referer;
pub mod plugins;
/// 数据服务进程生命周期（spawn/adopt/shutdown + service_endpoint）。
pub mod service;
/// 抓取浏览器 = Tauri 自己的 WebView2（隐藏窗口 + CDP 9334）。
pub mod webview_browser;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = plugins::configure(tauri::Builder::default())
        // 主 WebView2 注册防盗链头部改写。必须早于页面图片请求；失败只降级
        // (前端仍走 blob 隧道)，不阻止应用启动。
        .setup(|app| {
            #[cfg(windows)]
            media_referer::install(app);
            Ok(())
        })
        // WS 隧道连接管理(state):弹幕长连接按 connectionId 定位发/关。
        // Arc 包裹供 reader task clone 持引用(跨 command 共享)。
        .manage(std::sync::Arc::new(commands::ws::WsManager::default()))
        .manage(service::ServiceState::default())
        .invoke_handler(tauri::generate_handler![
            commands::http_get,
            service::service_endpoint,
            service::service_shutdown,
            commands::ws::ws_connect,
            commands::ws::ws_send,
            commands::ws::ws_close,
            commands::webview_browser::webview_browser_open,
            commands::webview_browser::webview_browser_set_mode,
            commands::webview_browser::webview_browser_close,
            commands::webview_browser::webview_browser_reset,
            commands::webview_browser::webview_browser_tidy,
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
        app.run(|app_handle, event| match event {
            // ⚠️ 抓取 webview 是**第二个窗口**：只关主窗口时 Tauri 的 windows 集合
            // 仍非空，不会自动退出 —— 进程会变成不可见、常驻数百 MB 的僵尸。
            // 主窗口销毁即显式退出应用。
            tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::Destroyed,
                ..
            } if label == "main" => {
                eprintln!("[tauri] main window destroyed → shutdown service");
                let state = app_handle.state::<service::ServiceState>();
                service::shutdown(&state);
                app_handle.exit(0);
            }
            // ⚠️ updater 的 install 走 `app.exit(0)`，**不经过**主窗口 Destroyed ——
            // 不在这里补一次，安装器会在数据服务/sidecar 还在退时开始替换文件
            // （表现为更新卡住、提示 browser 未完全退出）。shutdown 幂等。
            tauri::RunEvent::ExitRequested { .. } => {
                let state = app_handle.state::<service::ServiceState>();
                service::shutdown(&state);
            }
            // ⚠️ 不在 Exit 事件里清理抓取 webview：该事件在 Event::LoopDestroyed 才回调，
            // 此时投递任何窗口消息都不会再被处理（no-op）。进程退出会带走 WebView2 子进程
            // （2026-10-22 实机验证：带 lane 窗口关闭主窗口后浏览器进程同步消失）。
            _ => {}
        });
    }
}
