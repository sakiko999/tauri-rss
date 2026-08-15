//! xhs 签名 command:调 rustpython-xhs 跑 Python xhshow 生成签名 headers。

use std::collections::HashMap;

use tauri::async_runtime::spawn_blocking;

#[tauri::command]
pub async fn xhs_sign(
    uri: String,
    params: HashMap<String, String>,
    cookie: String,
) -> Result<rustpython_xhs::XhsSignHeaders, String> {
    // 签名含解释器初始化(~100ms,CPU 密集),放 blocking 池避免卡 async runtime。
    let mut p = serde_json::Map::new();
    for (k, v) in params {
        p.insert(k, serde_json::Value::String(v));
    }
    spawn_blocking(move || rustpython_xhs::sign_xhs(&uri, &p, &cookie))
        .await
        .map_err(|e| format!("签名任务失败:{e}"))?
}
