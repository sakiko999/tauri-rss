use tauri::Runtime;

/// Register all Tauri plugins for the app.
pub fn configure<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    // ⚠️ single-instance 必须第一个注册（Tauri 的要求）。第二个实例只聚焦
    // 已有主窗口：v1 的数据服务按 desktop 单实例设计，不允许多个 UI 同时写。
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        use tauri::Manager;
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }));

    let builder = builder
        .plugin(tauri_plugin_opener::init())
        // SQLite 存储(storage 门面):migration 不在此定义——DDL 归 core(db/schema.ts),
        // 与 CLI bun:sqlite 共用同一份,防漂移。
        .plugin(tauri_plugin_sql::Builder::default().build());

    // 自动更新(桌面):updater 校验并安装签名过的 NSIS 包;process 提供安装后的 relaunch。
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    builder
}
