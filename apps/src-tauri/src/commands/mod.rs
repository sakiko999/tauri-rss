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
pub mod ws;

use serde::{Deserialize, Serialize};

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
fn default_response_type() -> String {
    "text".to_string()
}

#[tauri::command]
pub async fn http_get(req: HttpGetRequest) -> Result<HttpResponse, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(5))
        .timeout(std::time::Duration::from_millis(req.timeout_ms))
        .build()
        .map_err(|e| e.to_string())?;

    let method = reqwest::Method::from_bytes(req.method.as_bytes()).map_err(|e| e.to_string())?;

    let mut builder = client.request(method, &req.url);
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
