//! 防盗链 Referer 注入(Windows / WebView2)。
//!
//! 背景:新浪图床等对空 Referer / 非站内 Referer 返回 403，而 `<img>` 原生请求
//! 只能带页面源(tauri://localhost)。旧方案是 Rust 全量下载 → base64 → IPC →
//! Blob，代价高且没有 HTTP 缓存。这里改为在 WebView2 网络层只**改写请求头**：
//! 请求仍由 Chromium 发出，缓存/HTTP2/Range/渐进解码全部保留。
//!
//! 边界:
//!   - 只对下面白名单 host 生效(与 resolve/media-referrer.ts 同一份规则，改一处要同步)；
//!   - 只改 `Referer`，不接管响应、不读取 body、不做网络请求；
//!   - 非 Windows / 旧 WebView2 注册失败时静默降级，前端仍有 blob 隧道兜底。
//!
//! 规则权威在 TS(`packages/resolve/src/media-referrer.ts`)。这里为了拦截回调
//! 不能跨语言调用，保留一份常量；`media-referrer-parity.check.ts` 守住两边一致。

use tauri::{Manager, Runtime};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2Controller, ICoreWebView2WebResourceRequestedEventArgs,
    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA,
};
use webview2_com::WebResourceRequestedEventHandler;
use windows::core::{HSTRING, PWSTR};

/// 图片防盗链规则(host 后缀 → 站内 Referer)。与 TS `MEDIA_REFERRERS` 同步。
const IMAGE_REFERRERS: &[(&str, &str)] = &[("sinaimg.cn", "https://weibo.com/")];

/// 视频防盗链规则(host 后缀 → 站内 Referer)。与 TS `VIDEO_REFERRERS` 同步。
const VIDEO_REFERRERS: &[(&str, &str)] = &[
    ("xhscdn.com", "https://www.xiaohongshu.com/"),
    ("weibocdn.com", "https://weibo.com/"),
    ("sinaimg.cn", "https://weibo.com/"),
];

/// 在 `setup` 阶段调用一次。失败只打日志，不影响应用启动(前端回退 blob 隧道)。
pub fn install<R: Runtime>(app: &tauri::App<R>) {
    let Some(window) = app.get_webview_window("main") else {
        eprintln!("[media-referer] main window not found; native referer disabled");
        return;
    };
    let result = window.with_webview(|webview| {
        let controller = webview.controller();
        // SAFETY: `with_webview` 保证回调在主线程执行，controller 属于该 WebView2。
        if let Err(e) = unsafe { install_for(controller) } {
            eprintln!("[media-referer] install failed: {e}");
        }
    });
    if let Err(e) = result {
        eprintln!("[media-referer] with_webview failed: {e}");
    }
}

unsafe fn install_for(controller: ICoreWebView2Controller) -> windows::core::Result<()> {
    let core = controller.CoreWebView2()?;

    // 事件回调只做 URI 解析 + 一次 SetHeader；禁止网络/async/大分配。
    let handler = WebResourceRequestedEventHandler::create(Box::new(
        |_sender, args: Option<ICoreWebView2WebResourceRequestedEventArgs>| {
            let Some(args) = args else { return Ok(()) };
            let request = args.Request()?;
            let mut uri = PWSTR::null();
            request.Uri(&mut uri)?;
            let uri = uri.to_string().unwrap_or_default();
            let host = reqwest::Url::parse(&uri)
                .ok()
                .and_then(|u| u.host_str().map(|h| h.to_ascii_lowercase()));
            let Some(host) = host else { return Ok(()) };

            let mut context = COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE;
            let _ = args.ResourceContext(&mut context);
            let rules = if context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA {
                VIDEO_REFERRERS
            } else {
                IMAGE_REFERRERS
            };
            let Some(referrer) = referer_for(rules, &host) else {
                return Ok(());
            };
            let headers = request.Headers()?;
            headers.SetHeader(&HSTRING::from("Referer"), &HSTRING::from(referrer))?;
            Ok(())
        },
    ));

    let mut token = 0i64;
    core.add_WebResourceRequested(&handler, &mut token)?;

    // 过滤器按 host + 协议 + 资源类型精确注册；glob 的 `*.host` 不覆盖 apex，
    // 所以 apex 与 wildcard 各注册一次。http 也注册，避免少量源站直链走混合内容前
    // 就已被拒。
    let mut hosts: Vec<&str> = IMAGE_REFERRERS.iter().map(|(h, _)| *h).collect();
    for (h, _) in VIDEO_REFERRERS {
        if !hosts.contains(h) {
            hosts.push(h);
        }
    }
    for host in hosts {
        for scheme in ["https", "http"] {
            for pattern in [
                format!("{scheme}://{host}/*"),
                format!("{scheme}://*.{host}/*"),
            ] {
                let pattern = HSTRING::from(pattern);
                let _ = core.AddWebResourceRequestedFilter(
                    &pattern,
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE,
                );
                let _ = core.AddWebResourceRequestedFilter(
                    &pattern,
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA,
                );
            }
        }
    }

    // token 仅用于卸载；应用生命周期内一直保留。
    let _ = token;
    Ok(())
}

/// host 命中后缀规则(精确或 `.suffix` 边界)，返回规则里的 Referer。
fn referer_for(rules: &'static [(&'static str, &'static str)], host: &str) -> Option<&'static str> {
    rules
        .iter()
        .find(|(suffix, _)| {
            host == *suffix
                || host
                    .strip_suffix(suffix)
                    .is_some_and(|prefix| prefix.ends_with('.'))
        })
        .map(|(_, referrer)| *referrer)
}
