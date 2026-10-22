//! 抓取浏览器（WebView2）的 Tauri 命令面。
//!
//! 本分支把浏览器后端从「spawn 系统 Edge」换成 Tauri 自己的 WebView2，
//! 详见 `crate::webview_browser`。命令与旧 `browser_*` 一一对应，TS 侧
//! `TauriBrowserBackend` 直接调用这里；CDP 客户端不变。
use tauri::AppHandle;

/// 确保抓取 webview 存在，返回 CDP 端口（幂等）。
// ⚠️ `(async)`：创建 webview 要回主线程并等结果，主线程执行会冻 UI。
#[tauri::command(async)]
pub fn webview_browser_open(app: AppHandle) -> Result<u16, String> {
    crate::webview_browser::open(&app)
}

/// hidden / interactive（interactive = 屏外显示，供滚动驱动页面用）。
#[tauri::command(async)]
pub fn webview_browser_set_mode(app: AppHandle, mode: String) -> Result<(), String> {
    crate::webview_browser::set_mode(&app, &mode)
}

/// 关闭抓取 webview（空闲回收 / 退出）。下次 `open` 重建。
#[tauri::command(async)]
pub fn webview_browser_close(app: AppHandle) -> Result<(), String> {
    crate::webview_browser::close(&app)
}

/// 清空抓取 profile（登录态/缓存）。
#[tauri::command(async)]
pub fn webview_browser_reset(app: AppHandle) -> Result<String, String> {
    crate::webview_browser::reset(&app)
}
