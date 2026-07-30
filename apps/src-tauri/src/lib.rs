pub mod commands;
pub mod plugins;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = plugins::configure(tauri::Builder::default())
        .invoke_handler(tauri::generate_handler![commands::greet]);

    #[cfg(mobile)]
    builder
        .run(tauri::generate_context!("tauri.conf.mobile.json"))
        .expect("error while running tauri application");

    #[cfg(not(mobile))]
    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
