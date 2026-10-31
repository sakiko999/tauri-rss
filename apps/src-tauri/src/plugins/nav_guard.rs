//! 主窗口导航守卫（2026-11-01，基本安全保障）。
//!
//! 主窗口只该停在应用自身页面：前端路由走 History API，不产生导航；外链由前端
//! `openExternal` 交给系统浏览器。还会走到这里的只有「漏网」导航 —— 第三方 feed
//! 正文里没被前端拦下的链接、表单提交等。放任它们会把整个应用窗口换成外站页面
//! （`withGlobalTauri` 下该页还能看到 IPC 注入面）。处理：http(s)/mailto 交给系统
//! 浏览器，其余一律取消。只管 label = "main"；抓取浏览器等其它窗口照常导航。

use tauri::{plugin::TauriPlugin, Manager, Runtime, Url};

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("nav-guard")
        .on_navigation(|webview, url| {
            if webview.label() != "main" {
                return true;
            }
            // devUrl 只在 `tauri dev`（含 tauri:release 的 --release）形态放行；
            // 正式包（custom-protocol）里 localhost:1420 与外站无异。
            let dev = if tauri::is_dev() {
                webview.config().build.dev_url.as_ref()
            } else {
                None
            };
            if is_app_url(url, dev) {
                return true;
            }
            if matches!(url.scheme(), "http" | "https" | "mailto") {
                if let Err(e) = tauri_plugin_opener::open_url(url.as_str(), None::<&str>) {
                    eprintln!("[nav-guard] 交给系统浏览器失败 {url}: {e}");
                }
            }
            eprintln!("[nav-guard] 已拦截主窗口导航：{url}");
            false
        })
        .build()
}

/// 应用自身页面：正式包 `http(s)://tauri.localhost`（Windows）/ `tauri://localhost`（其它平台）、
/// dev 形态的 devUrl 同源、`about:blank`、本应用 origin 下的 `blob:`（OPML 导出走 `<a download>`）。
fn is_app_url(url: &Url, dev: Option<&Url>) -> bool {
    match url.scheme() {
        "tauri" => true,
        "http" | "https" => {
            url.host_str() == Some("tauri.localhost")
                || dev.is_some_and(|d| d.origin() == url.origin())
        }
        "blob" => Url::parse(url.path()).is_ok_and(|inner| is_app_url(&inner, dev)),
        "about" => url.path() == "blank",
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn app_pages_pass() {
        assert!(is_app_url(&u("http://tauri.localhost/"), None));
        assert!(is_app_url(&u("https://tauri.localhost/v/home"), None));
        assert!(is_app_url(&u("tauri://localhost/index.html"), None));
        assert!(is_app_url(&u("about:blank"), None));
        assert!(is_app_url(
            &u("blob:http://tauri.localhost/5f1c-uuid"),
            None
        ));
    }

    #[test]
    fn dev_url_only_when_given() {
        let dev = u("http://localhost:1420");
        assert!(is_app_url(&u("http://localhost:1420/play/x"), Some(&dev)));
        assert!(!is_app_url(&u("http://localhost:1420/"), None));
        assert!(!is_app_url(&u("http://localhost:1421/"), Some(&dev)));
    }

    #[test]
    fn foreign_pages_blocked() {
        assert!(!is_app_url(&u("https://example.com/"), None));
        assert!(!is_app_url(&u("https://tauri.localhost.evil.com/"), None));
        assert!(!is_app_url(&u("blob:https://example.com/uuid"), None));
        assert!(!is_app_url(&u("data:text/html,<h1>x</h1>"), None));
        assert!(!is_app_url(&u("javascript:alert(1)"), None));
        assert!(!is_app_url(&u("about:srcdoc"), None));
    }
}
