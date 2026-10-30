//! 防盗链 Referer 注入(Windows / WebView2)。
//!
//! 背景:新浪图床等对空 Referer / 非站内 Referer 返回 403，而 `<img>` 原生请求
//! 只能带页面源(tauri://localhost)。旧方案是 Rust 全量下载 → base64 → IPC →
//! Blob，代价高且没有 HTTP 缓存。这里改为在 WebView2 网络层只**改写请求头**：
//! 请求仍由 Chromium 发出，缓存/HTTP2/Range/渐进解码全部保留。
//!
//! 边界:
//!   - 只对下面白名单 host 生效(与 resolve/media-referrer.ts 同一份规则，改一处要同步)；
//!   - 只改请求头(图片/视频 = `Referer`；XHR/fetch = `Origin`/`User-Agent`)，不接管
//!     响应、不读取 body、不做网络请求；
//!   - 非 Windows / 旧 WebView2 注册失败时静默降级(实况视频仍有 blob 隧道兜底；
//!     防盗链图片无回退，直接 403 占位)。
//!
//! 规则权威在 TS(`packages/resolve/src/media-referrer.ts`)。这里为了拦截回调
//! 不能跨语言调用，保留一份常量；`media-referrer-parity.check.ts` 守住两边一致。

use tauri::{Manager, Runtime};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2Controller, ICoreWebView2Settings2, ICoreWebView2WebResourceRequestedEventArgs,
    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FETCH, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE,
    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_XML_HTTP_REQUEST,
};
use webview2_com::WebResourceRequestedEventHandler;
use windows::core::{Interface, HSTRING, PWSTR};
use windows_sys::Win32::System::Com::CoTaskMemFree;

/// 图片防盗链规则(host 后缀 → 站内 Referer)。与 TS `MEDIA_REFERRERS` 同步。
const IMAGE_REFERRERS: &[(&str, &str)] = &[("sinaimg.cn", "https://weibo.com/")];

/// 视频防盗链规则(host 后缀 → 站内 Referer)。与 TS `VIDEO_REFERRERS` 同步。
const VIDEO_REFERRERS: &[(&str, &str)] = &[
    ("xhscdn.com", "https://www.xiaohongshu.com/"),
    ("weibocdn.com", "https://weibo.com/"),
    ("sinaimg.cn", "https://weibo.com/"),
    // 抖音作品直链：无 Referer 403、带 douyin.com 206(2026-10-30 实测)。
    ("douyinvod.com", "https://www.douyin.com/"),
];

/// XHR/fetch 的 Origin 改写规则(host 后缀 → 站内 Origin)。与 TS `XHR_ORIGIN_RULES` 同步。
/// Twitch playlist 域对页面源 Origin(`*.tauri.localhost`)回 403,hls.js 的 manifest
/// 请求(JS 禁改 Origin)只能在这层改写 —— 详见 resolve/media-referrer.ts 注释。
/// ⚠️ 值**不带尾斜杠**:带斜杠的 Origin 会被 CDN 回 403(2026-10-30 实测)。
const XHR_ORIGIN_RULES: &[(&str, &str)] = &[("playlist.ttvnw.net", "https://www.twitch.tv")];

/// XHR/fetch 的 UA 改写规则(host 后缀 → 指定 UA)。与 TS `XHR_UA_RULES` 同步。
/// huya HLS CDN 只认这条 HYSDK 串(浏览器 UA → 403 text/html,2026-10-30 实测
/// manifest 与分片一致);Referer/Origin 不是判据。
const XHR_UA_RULES: &[(&str, &str)] =
    &[("hls.huya.com", "HYSDK(Windows, 30000002)_APP(pc_exe&7060000&official)_SDK(trans&2.32.3.5646)")];

/// 媒体请求**去 Edge 品牌**(host 后缀)。与 TS `MEDIA_UA_STRIP_HOSTS` 同步。
///
/// 喜马拉雅 CDN 的 WAF 回 **403 text/html** + 响应头 `x-error-info: ua_acl.access`,
/// 即**一条完整的 UA 字面串**被拉进了黑名单 —— 恰好就是当前 Windows WebView2 的真实
/// UA(`… Chrome/156.0.0.0 Safari/537.36 Edg/156.0.0.0`)。2026-10-29 实测粒度是
/// **整串等值、大小写不敏感**:`EDG` 大写也 403;而 mac 平台串、去掉 `Mozilla/5.0`
/// 前缀、`Safari/537.36` 后双空格、`Edg/156`(无补丁位)、`Edg/156.0.0.1`、
/// `Chrome/155 + Edg/156`、只留 `Chrome/156.0.0.0 Edg/156.0.0.0` 全部 206。
/// 即不存在「按版本号拦 Edge」的规则,能撞上的只有那一条字面串。403 又被 ORB 拦成
/// `net::ERR_BLOCKED_BY_ORB`,媒体元素只报 `MEDIA_ELEMENT_ERROR: Format error`
/// —— 表象像解码问题,实为 UA 黑名单。
///
/// 处理:只把 ` Edg/<ver>` 一段去掉(保留真实 Chromium 版本)。**不含任何版本号**:
/// 字符串一变就不等于黑名单条目了;Edge 升级后自动跟随,黑名单若跟着更新也照样躲开
/// (含 Edg 的任何 UA 都不再等于那条记录)。
const UA_STRIP_EDG_HOSTS: &[&str] = &["xmcdn.com", "ximalaya.com"];

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

    // 去品牌 UA 在安装期算一次(回调里不能做字符串查找外的活)。取 Settings 里的 UA
    // (默认即 WebView2 真实 UA)而不是请求头:拦截发生时 UA 还没由网络栈写入请求头。
    // ⚠️ UserAgent 访问器在 **Settings2**(WebView2 ≥ 1.0.864);旧运行时不支持 → None,
    // 那种环境本来也不会跑到这里(整包要求现代 WebView2),静默不改写即可。
    let debranded_ua: Option<String> = (|| {
        let settings = core.Settings().ok()?.cast::<ICoreWebView2Settings2>().ok()?;
        let mut ua = PWSTR::null();
        settings.UserAgent(&mut ua).ok()?;
        let ua_ptr = ua.0 as *const core::ffi::c_void;
        let full = ua.to_string().unwrap_or_default();
        if !ua_ptr.is_null() {
            // SAFETY: 出参所有权已随 out-param 转移给本作用域。
            unsafe { CoTaskMemFree(ua_ptr) };
        }
        let stripped = strip_edge_brand(&full);
        (stripped != full).then_some(stripped)
    })();

    // 事件回调只做 URI 解析 + 一次 SetHeader；禁止网络/async/大分配。
    let handler = WebResourceRequestedEventHandler::create(Box::new(
        move |_sender, args: Option<ICoreWebView2WebResourceRequestedEventArgs>| {
            let Some(args) = args else { return Ok(()) };
            let request = args.Request()?;
            let mut uri = PWSTR::null();
            request.Uri(&mut uri)?;
            // ⚠️ COM 出参由调用方释放（CoTaskMemAlloc）。不释放则每个命中规则的
            // 图片/媒体请求泄漏一段原生内存 —— 微博图文流一次滚动就是上百次。
            let uri_ptr = uri.0 as *const core::ffi::c_void;
            let uri = uri.to_string().unwrap_or_default();
            if !uri_ptr.is_null() {
                // SAFETY: 指针来自上面的 Uri() 出参，所有权已随出参转移给本作用域，
                // 且 to_string() 只读、不再持有它。
                unsafe { CoTaskMemFree(uri_ptr) };
            }
            let host = reqwest::Url::parse(&uri)
                .ok()
                .and_then(|u| u.host_str().map(|h| h.to_ascii_lowercase()));
            let Some(host) = host else { return Ok(()) };

            let mut context = COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE;
            let _ = args.ResourceContext(&mut context);
            let headers = request.Headers()?;
            if context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_XML_HTTP_REQUEST
                || context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FETCH
            {
                // XHR/fetch(hls.js manifest/分片):按域改写 Origin / UA。两者各管各的
                // —— Twitch playlist 拒页面源 Origin;huya HLS 只认播放器 UA。
                if let Some(origin) = suffix_rule_for(XHR_ORIGIN_RULES, &host) {
                    headers.SetHeader(&HSTRING::from("Origin"), &HSTRING::from(origin))?;
                }
                if let Some(ua) = suffix_rule_for(XHR_UA_RULES, &host) {
                    headers.SetHeader(&HSTRING::from("User-Agent"), &HSTRING::from(ua))?;
                }
                return Ok(());
            }
            let is_media = context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA;
            // 媒体去 Edge 品牌(喜马拉雅 CDN 的 UA 黑名单,见 UA_STRIP_EDG_HOSTS)。
            // ⚠️ 与 Referer 规则**互不依赖**:命中 UA 规则但没 Referer 规则的域(如
            // xmcdn.com 音频)也必须改写,所以先处理 UA 再按需设 Referer。
            if is_media {
                if let Some(ua) = debranded_ua.as_deref() {
                    if host_matches(UA_STRIP_EDG_HOSTS, &host) {
                        headers.SetHeader(&HSTRING::from("User-Agent"), &HSTRING::from(ua))?;
                    }
                }
            }
            let rules = if is_media { VIDEO_REFERRERS } else { IMAGE_REFERRERS };
            let Some(referrer) = suffix_rule_for(rules, &host) else {
                return Ok(());
            };
            headers.SetHeader(&HSTRING::from("Referer"), &HSTRING::from(referrer))?;
            Ok(())
        },
    ));

    let mut token = 0i64;
    core.add_WebResourceRequested(&handler, &mut token)?;

    // 过滤器按 host + 协议 + 资源类型精确注册；glob 的 `*.host` 不覆盖 apex，
    // 所以 apex 与 wildcard 各注册一次。http 也注册，避免少量源站直链走混合内容前
    // 就已被拒。
    let media_hosts: Vec<&str> = {
        let mut hosts: Vec<&str> = IMAGE_REFERRERS.iter().map(|(h, _)| *h).collect();
        for (h, _) in VIDEO_REFERRERS {
            if !hosts.contains(h) {
                hosts.push(h);
            }
        }
        hosts
    };
    for host in media_hosts {
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
    // 只改 UA 的域(音频 CDN 等)按 MEDIA context 注册。
    for host in UA_STRIP_EDG_HOSTS {
        for scheme in ["https", "http"] {
            for pattern in [
                format!("{scheme}://{host}/*"),
                format!("{scheme}://*.{host}/*"),
            ] {
                let pattern = HSTRING::from(pattern);
                let _ = core.AddWebResourceRequestedFilter(
                    &pattern,
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA,
                );
            }
        }
    }
    // XHR/fetch 域(hls.js manifest 等)单独按请求 context 注册；Origin 与 UA 两类规则
    // 的 host 集可能不同，各自注册一遍。
    for (host, _) in XHR_ORIGIN_RULES.iter().chain(XHR_UA_RULES.iter()) {
        for scheme in ["https", "http"] {
            for pattern in [
                format!("{scheme}://{host}/*"),
                format!("{scheme}://*.{host}/*"),
            ] {
                let pattern = HSTRING::from(pattern);
                let _ = core.AddWebResourceRequestedFilter(
                    &pattern,
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_XML_HTTP_REQUEST,
                );
                let _ =
                    core.AddWebResourceRequestedFilter(&pattern, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FETCH);
            }
        }
    }

    // token 仅用于卸载；应用生命周期内一直保留。
    let _ = token;
    Ok(())
}

/// host 命中后缀规则(精确或 `.suffix` 边界)，返回规则里的值(Referer 或 Origin)。
fn suffix_rule_for(rules: &'static [(&'static str, &'static str)], host: &str) -> Option<&'static str> {
    rules
        .iter()
        .find(|(suffix, _)| host_matches_one(suffix, host))
        .map(|(_, referrer)| *referrer)
}

/// host 是否命中后缀列表(精确或 `.suffix` 边界)。
fn host_matches(suffixes: &[&str], host: &str) -> bool {
    suffixes.iter().any(|s| host_matches_one(s, host))
}

fn host_matches_one(suffix: &str, host: &str) -> bool {
    host == suffix
        || host
            .strip_suffix(suffix)
            .is_some_and(|prefix| prefix.ends_with('.'))
}

/// 去掉 UA 里的 ` Edg/<ver>` 段(`Mozilla/5.0 … Chrome/156.0.0.0 Safari/537.36 Edg/156.0.0.0`
/// → `… Safari/537.36`)。没命中返回原串(调用方据此判断要不要注册改写)。
fn strip_edge_brand(ua: &str) -> String {
    let Some(start) = ua.find(" Edg/") else {
        return ua.to_string();
    };
    let after = &ua[start + 1..];
    let end = after.find(' ').map_or(ua.len(), |i| start + 1 + i);
    let mut out = String::with_capacity(ua.len());
    out.push_str(ua[..start].trim_end());
    out.push_str(&ua[end..]);
    out
}
