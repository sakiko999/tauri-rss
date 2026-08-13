// 直播弹幕服务器 TLS 可达性探测(诊断用)。
// 用当前 ws.rs 同款 tokio-tungstenite native-tls(schannel)连各平台弹幕服务器,
// 统计 WS 握手成功率,验证「统一走 Rust 隧道」可行性。
// 运行:cd apps/src-tauri && cargo run --example douyu_probe
use std::time::Duration;

use tokio_tungstenite::connect_async;

#[tokio::main]
async fn main() {
    let urls: &[(&str, &str)] = &[
        ("douyu", "wss://danmuproxy.douyu.com:8506/"),
        ("bili", "wss://zj-cn-live-comet.chat.bilibili.com:2245/sub"),
        ("huya", "wss://cdnws.api.huya.com/"),
    ];
    for (name, url) in urls {
        let mut ok = 0usize;
        let total = 4;
        for i in 0..total {
            let res = tokio::time::timeout(Duration::from_secs(8), connect_async(*url)).await;
            match res {
                Ok(Ok((_ws, _resp))) => {
                    ok += 1;
                    println!("[{name}][{i}] OK 握手成功")
                }
                Ok(Err(e)) => println!("[{name}][{i}] ERR: {e}"),
                Err(_) => println!("[{name}][{i}] TIMEOUT"),
            }
        }
        println!("{name}: TLS/WS 握手 success {ok}/{total}");
    }
}
