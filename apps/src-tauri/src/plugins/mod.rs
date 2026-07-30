use tauri::Runtime;

/// Register all Tauri plugins for the app.
pub fn configure<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.plugin(tauri_plugin_opener::init())
}
