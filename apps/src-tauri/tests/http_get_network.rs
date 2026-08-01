//! Network integration test for the `http_get` command's reqwest path.
//!
//! Verifies the CORS-free HTTP tunnel can actually fetch the same test feeds
//! the desktop app uses, returning non-empty RSS/Atom bodies with a 2xx status.
//! These hit real public services; the test is `#[ignore]` by default so a
//! flaky network never breaks `cargo test`. Run with:
//!   `cargo test --test http_get_network -- --ignored`
use tauri_app_lib::commands::{http_get, HttpGetRequest};

async fn fetch_feed(url: &str) -> (u16, usize) {
    let res = http_get(HttpGetRequest {
        url: url.to_string(),
        method: "GET".to_string(),
        headers: std::collections::HashMap::from([(
            "user-agent".to_string(),
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36".to_string(),
        )]),
        body: None,
        timeout_ms: 20_000,
        response_type: "text".to_string(),
    })
    .await
    .expect("http_get returned an error");
    (res.status, res.body.len())
}

#[tokio::test]
#[ignore = "hits real network — run with --ignored"]
async fn fetches_ruanyifeng_atom() {
    let (status, len) = fetch_feed("https://www.ruanyifeng.com/blog/atom.xml").await;
    assert!(status >= 200 && status < 300, "status was {status}");
    assert!(len > 200, "body too short: {len}");
}

#[tokio::test]
#[ignore = "hits real network — run with --ignored"]
async fn fetches_hn_rss() {
    let (status, len) = fetch_feed("https://hnrss.org/frontpage").await;
    assert!(status >= 200 && status < 300, "status was {status}");
    assert!(len > 200, "body too short: {len}");
}

#[tokio::test]
#[ignore = "hits real network — run with --ignored"]
async fn fetches_coolshell_rss() {
    let (status, len) = fetch_feed("https://coolshell.cn/feed").await;
    assert!(status >= 200 && status < 300, "status was {status}");
    assert!(len > 200, "body too short: {len}");
}
