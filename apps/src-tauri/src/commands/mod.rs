//! 网络能力:http_get(HTTP 隧道)+ ws 模块(WebSocket 隧道,弹幕)。
//! CORS-free HTTP passthrough — the only network capability the frontend uses.
//!
//! The webview's `fetch()` honors CORS, so RSS feeds and live-platform APIs
//! (which send no CORS headers) can't be fetched directly. This command tunnels
//! a request through the native Rust stack (reqwest) and returns raw bytes so
//! the JS data layer (`PlatformHost.http`) parses them like any other response.
//!
//! Body transport:
//!   - `responseType: "text"` | `"json"`  → utf-8 `String` body
//!   - `responseType: "arraybuffer"`      → base64-encoded bytes (decoded in JS)
pub mod webview_browser;
pub mod ws;

use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpGetRequest {
    pub url: String,
    #[serde(default = "default_method")]
    pub method: String,
    #[serde(default)]
    pub headers: std::collections::HashMap<String, String>,
    /// Body for POST/PUT/DELETE. Sent as utf-8 text.
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default = "default_timeout")]
    pub timeout_ms: u64,
    #[serde(default = "default_response_type")]
    pub response_type: String,
}

#[derive(Debug, Serialize)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: std::collections::HashMap<String, String>,
    /// utf-8 text for text/json; base64 for arraybuffer.
    pub body: String,
}

fn default_method() -> String {
    "GET".to_string()
}
fn default_timeout() -> u64 {
    20_000
}
/// Timeout clamp. Unbounded means a caller passing `u64::MAX` parks a connection and a
/// task effectively forever (no cancellation path), and one hung renderer request can
/// exhaust the pool. 5 min is far above any legitimate platform fetch.
const MAX_TIMEOUT_MS: u64 = 300_000;
const MIN_TIMEOUT_MS: u64 = 1_000;
/// Reject URLs aimed at private / link-local / mDNS hosts.
///
/// This tunnel takes any URL from the webview by design (feeds and platform APIs live on
/// arbitrary hosts; there is no fixed allowlist), and it hands the response body back to
/// JS. What it must not do is let feed-supplied content (e.g. a hostile `image` URL) turn
/// the renderer into a LAN scanner or reach a cloud metadata endpoint — `169.254.169.254`
/// is the classic credential-theft target and lives in link-local.
///
/// ⚠️ **Loopback is deliberately allowed**: the browser-simulation path drives the Edge
/// instance we spawn ourselves over `127.0.0.1:<cdp-port>` (both the `/json/list` HTTP
/// probe and the CDP websocket). Blocking it breaks weibo/xhs/douyin crawling outright.
/// Residual risk: loopback-only probing from hostile content. Acceptable — it yields no
/// readable body in any current sink (see docs/security-review notes).
pub(crate) fn is_blocked_host(url: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return true; // unparseable → refuse rather than pass through
    };
    let Some(host) = parsed.host_str() else {
        return true;
    };
    // IPv6 literals arrive bracketed from Url::host_str.
    let host = host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_ascii_lowercase();
    if host.ends_with(".local") || host.ends_with(".internal") {
        return true; // mDNS / split-horizon names resolving inside a LAN
    }
    match host.parse::<std::net::IpAddr>() {
        Ok(ip) => match ip {
            std::net::IpAddr::V4(v4) => v4.is_private() || v4.is_link_local(),
            // ⚠️ IPv4-mapped IPv6(`::ffff:192.168.1.1`)会 parse 成 V6,但 OS 实际按 v4 连接。
            // 不先还原的话 `segments()[0] == 0` 既非 fc00::/7 也非 fe80 → 绕过内网/元数据拦截
            // (`::ffff:169.254.169.254` 拉云元数据)。先 to_ipv4_mapped 走 v4 判定。
            std::net::IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
                Some(v4) => v4.is_private() || v4.is_link_local(),
                None => v6.is_unique_local() || (v6.segments()[0] & 0xffc0) == 0xfe80,
            },
        },
        // 非 IP 字面量(域名)放行:解析结果不在此校验,公网域名正常可达。
        Err(_) => false,
    }
}

fn default_response_type() -> String {
    "text".to_string()
}

/// 进程级共享 HTTP Client：复用连接池、keep-alive 与 TLS 会话。
///
/// ⚠️ 重定向**逐跳复查**:`Policy::limited` 只数次数,不校验跳转目标 —— 公网 URL
/// 302 → `http://169.254.169.254/`(云元数据)会绕过入口的 is_blocked_host 检查。
/// 自定义策略对每个目标再跑一次同一判定(loopback 仍按设计放行,见 is_blocked_host)。
fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                if attempt.previous().len() >= 5 {
                    attempt.error("too many redirects")
                } else if is_blocked_host(attempt.url().as_str()) {
                    attempt.error("refused: redirect target is not routable")
                } else {
                    attempt.follow()
                }
            }))
            .build()
            .expect("failed to build shared reqwest client")
    })
}

#[tauri::command]
pub async fn http_get(req: HttpGetRequest) -> Result<HttpResponse, String> {
    if is_blocked_host(&req.url) {
        return Err("refused: target address is not routable (loopback/link-local/private)".into());
    }
    let timeout = req.timeout_ms.clamp(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
    let client = http_client();

    let method = reqwest::Method::from_bytes(req.method.as_bytes()).map_err(|e| e.to_string())?;

    // ⚠️ 超时按请求设置：共享 Client 不能把 timeout 写死在 builder 上（不同调用方
    // 需要不同上限），但连接池/TLS 会话必须复用 —— 每请求新建 Client 会让图片和
    // 分片每次重新握手，是隧道吞吐上不去的主因之一。
    let mut builder = client
        .request(method, &req.url)
        .timeout(std::time::Duration::from_millis(timeout));
    for (k, v) in &req.headers {
        builder = builder.header(k, v);
    }
    if let Some(body) = &req.body {
        builder = builder.body(body.clone());
    }

    let res = builder.send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let mut headers = std::collections::HashMap::new();
    for (k, v) in res.headers() {
        if let Ok(value) = v.to_str() {
            // Collapse set-cookie into a single joined value (matches BrowserHost).
            if k.as_str().eq_ignore_ascii_case("set-cookie") {
                let prev: &mut String = headers.entry("set-cookie".to_string()).or_default();
                if !prev.is_empty() {
                    prev.push('\n');
                }
                prev.push_str(value);
            } else {
                headers.insert(k.to_string(), value.to_string());
            }
        }
    }

    let body = if req.response_type == "arraybuffer" {
        let bytes = res.bytes().await.map_err(|e| e.to_string())?;
        use base64::Engine;
        base64::engine::general_purpose::STANDARD.encode(bytes)
    } else {
        res.text().await.map_err(|e| e.to_string())?
    };

    Ok(HttpResponse {
        status,
        headers,
        body,
    })
}
