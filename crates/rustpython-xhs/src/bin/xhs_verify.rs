//! 临时验证(验后删):rustpython-xhs 生成签名 → 真实请求 user_posted 确认 200。
//! 用法:`XHS_COOKIE="...完整cookie..." cargo run --release -p rustpython-xhs --bin xhs_verify`
//! cookie 从环境变量读(不进 git;缺失时打印提示)。
use rustpython_xhs::{params_map, sign_xhs};

fn main() {
    let cookie = std::env::var("XHS_COOKIE").unwrap_or_else(|_| {
        eprintln!("用法: XHS_COOKIE=\"<完整 cookie 串>\" cargo run --release -p rustpython-xhs --bin xhs_verify");
        std::process::exit(1);
    });
    let user_id = "593032945e87e77791e03696"; // 小宇菇菇
    let uri = "/api/sns/web/v1/user_posted";
    let params = params_map(&[("num", "30"), ("cursor", ""), ("user_id", user_id)]);

    let headers = sign_xhs(uri, &params, &cookie).expect("sign_xhs 失败");
    println!("=== 签名 headers ===");
    println!("x-s        = {}", headers.x_s);
    println!("x-s-common = {}", headers.x_s_common);
    println!("x-t        = {}", headers.x_t);

    // 用签名 headers + cookie 请求 user_posted
    let url = format!("https://edith.xiaohongshu.com{uri}?num=30&cursor=&user_id={user_id}");
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .expect("client");

    let res = client
        .get(&url)
        .header("Cookie", &cookie)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
        .header("Referer", "https://www.xiaohongshu.com/")
        .header("x-s", &headers.x_s)
        .header("x-s-common", &headers.x_s_common)
        .header("x-t", &headers.x_t)
        .header("x-b3-traceid", &headers.x_b3_traceid)
        .header("x-xray-traceid", &headers.x_xray_traceid)
        .header("x-mns", &headers.x_mns)
        .header("xy-direction", &headers.xy_direction)
        .send()
        .expect("请求失败");
    println!("\n=== 请求结果 ===");
    println!("status = {}", res.status());
    let text = res.text().expect("读 body");
    let preview = &text[..text.len().min(400)];
    println!("body = {preview}");
    if text.contains("\"code\":0") || text.contains("\"code\": 0") {
        println!("\n✅ 签名有效:服务器 code:0");
    } else if text.contains("\"code\":-101") {
        println!("\n❌ 签名被拒 -101(未登录/签名无效)");
    } else if text.contains("\"code\":461") {
        println!("\n❌ 签名过时 461");
    }
}
