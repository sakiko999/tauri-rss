//! WebSocket 隧道 — 直播弹幕(douyin 需带 UA/Cookie/Origin 自定义握手 header)。
//!
//! 浏览器原生 `WebSocket` 无法带自定义 header,而 douyin 弹幕服务端在握手时
//! 校验这些 header(残缺 cookie → 417、陈旧 ttwid → 415 DEVICE_BLOCKED)。本模块
//! 用 tokio-tungstenite 建 WS(可带任意 header),经 `tauri::ipc::Channel` 把
//! 二进制帧回传前端(base64,与 http_get 的 arraybuffer 约定一致)。
//!
//! 接口(前端 `packages/host/src/tauri/tauri-ws-backend.ts` 对应):
//!   - `ws_connect(req, on_event)`  → 握手成功返回 connectionId;失败 reject(零残留)
//!   - `ws_send(connectionId, payload)` → 按连接发二进制
//!   - `ws_close(connectionId)`     → 关闭指定连接(前端退订)
//!
//! 生命周期:读半部归 reader task,写半部(sink)归 WsManager。前端退订 → ws_close
//! 移除 map(drop sink)+ 发 shutdown 信号终止 task;webview 销毁 → Channel 被 GC →
//! `on_event.send()` 返回 Err → task 自终止。两条路径都不会泄漏。
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use base64::Engine as _;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::State;
use tokio::net::TcpStream;
use tokio::sync::{mpsc, Mutex as AsyncMutex};
use tokio_tungstenite::tungstenite::client::IntoClientRequest as _;
use tokio_tungstenite::tungstenite::http;
use tokio_tungstenite::tungstenite::{Error as WsError, Message};
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

type WsStream = WebSocketStream<MaybeTlsStream<TcpStream>>;
/// 写半部(Arc 共享给 ws_send/ws_close)。std Mutex 只 guard 结构,await 前释放。
type WsSink = Arc<AsyncMutex<futures_util::stream::SplitSink<WsStream, Message>>>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WsConnectRequest {
    pub url: String,
    /// 自定义握手 header(UA / Cookie / Origin 等)。
    #[serde(default)]
    pub headers: HashMap<String, String>,
    /// 握手超时,ms。
    #[serde(default = "default_ws_timeout")]
    pub timeout_ms: u64,
}

fn default_ws_timeout() -> u64 {
    20_000
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WsConnectResult {
    pub connection_id: String,
}

/// 回传前端 Channel 的事件。tag/content 布局 → JS 端 `ev.event`/`ev.data`。
#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum WsEvent {
    Open,
    /// 入站二进制帧,base64 编码(与 http_get arraybuffer 约定一致)。
    Binary(String),
    Close { code: u16, reason: String },
    Error { message: String },
}

/// 单连接状态:sink(写半部)+ 退订信号。
struct WsConn {
    sink: WsSink,
    shutdown_tx: mpsc::Sender<()>,
}

/// 连接管理器(state,进程级):按 connectionId 定位写/关;id 自增无需 uuid。
#[derive(Default)]
pub struct WsManager {
    conns: Mutex<HashMap<String, WsConn>>,
    next_id: AtomicU64,
}

impl WsManager {
    fn remove(&self, connection_id: &str) {
        // drop 掉 sink(写半部)→ socket 写侧关闭。
        if let Ok(mut conns) = self.conns.lock() {
            conns.remove(connection_id);
        }
    }
}

/// 握手失败时尽量提取 HTTP 状态码(douyin 415)。
fn describe_error(e: &WsError) -> String {
    if let WsError::Http(resp) = e {
        return format!("ws handshake failed: HTTP {}", resp.status());
    }
    e.to_string()
}

/// 建连:握手成功才注册并返回 connectionId;失败直接 reject(无半开连接)。
#[tauri::command]
pub async fn ws_connect(
    req: WsConnectRequest,
    on_event: Channel<WsEvent>,
    state: State<'_, Arc<WsManager>>,
) -> Result<WsConnectResult, String> {
    // 1. 从 URL 构造完整 WS 请求(IntoClientRequest for &str 自动生成 Sec-WebSocket-Key/
    //    Host/Connection/Upgrade/Version),再插入自定义 header。
    //    ⚠️ 不能手动 Request::builder() 构造 Request<()> 再传 connect_async——Request<()>
    //    的 IntoClientRequest 是 Ok(self) 不补 WS 头,generate_request 校验缺
    //    Sec-WebSocket-Key 报 InvalidHeader("Missing, duplicated or incorrect header
    //    sec-websocket-key")(2026-08 实测 douyin/bili 走隧道握手失败根因)。
    let mut request = req
        .url
        .as_str()
        .into_client_request()
        .map_err(|e| e.to_string())?;
    for (k, v) in &req.headers {
        if let (Ok(k), Ok(v)) = (
            http::header::HeaderName::try_from(k.as_str()),
            http::header::HeaderValue::try_from(v.as_str()),
        ) {
            request.headers_mut().insert(k, v);
        }
    }

    // 2. 握手 + 超时。失败 → Err,未注册任何连接,零泄漏。
    let timeout = std::time::Duration::from_millis(req.timeout_ms);
    let res = tokio::time::timeout(timeout, connect_async(request)).await;
    let (ws, _resp) = res
        .map_err(|_| {
            println!("[ws] connect timeout: {}", req.url);
            "ws handshake timed out".to_string()
        })?
        .map_err(|e| {
            println!("[ws] connect err: {} — {}", req.url, describe_error(&e));
            describe_error(&e)
        })?;

    let (sink, mut stream) = ws.split();

    // 3. 注册连接。id 自增生成(管理器持 std Mutex,并发安全)。
    let connection_id = format!("ws-{}", state.next_id.fetch_add(1, Ordering::Relaxed));
    println!("[ws] connect ok: {connection_id}");
    let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>(1);
    {
        let mut conns = state.conns.lock().map_err(|e| e.to_string())?;
        conns.insert(
            connection_id.clone(),
            WsConn {
                sink: Arc::new(AsyncMutex::new(sink)),
                shutdown_tx,
            },
        );
    }

    // 4. 通知 onOpen(前端此时回发认证/心跳帧 → 走 ws_send)。
    let _ = on_event.send(WsEvent::Open);

    // 5. reader task 收帧转发;Channel 死掉(send 失败)/服务端关/ws_close 任一 → 自终止。
    let manager = state.inner().clone();
    let conn_id = connection_id.clone();
    tokio::spawn(async move {
        let mut shutdown_rx = shutdown_rx;
        loop {
            tokio::select! {
                msg = stream.next() => {
                    let dead = match msg {
                        Some(Ok(Message::Binary(b))) => {
                            let b64 = base64::engine::general_purpose::STANDARD.encode(b);
                            on_event.send(WsEvent::Binary(b64)).is_err()
                        }
                        Some(Ok(Message::Text(_))) => {
                            on_event.send(WsEvent::Error { message: "unexpected text frame".into() }).is_err()
                        }
                        // Ping 自动回 Pong(tungstenite 库本会自动处理,这里显式忽略)。
                        Some(Ok(Message::Ping(_) | Message::Pong(_) | Message::Frame(_))) => false,
                        Some(Ok(Message::Close(f))) => {
                            // tungstenite CloseCode → u16:CloseCode 有 Into<u16>。
                            let (code, reason) = f.map(|c| (c.code.into(), c.reason.into_owned()))
                                .unwrap_or((1006, String::new()));
                            on_event.send(WsEvent::Close { code, reason }).is_err()
                        }
                        Some(Err(e)) => {
                            let _ = on_event.send(WsEvent::Error { message: e.to_string() });
                            on_event.send(WsEvent::Close { code: 1006, reason: e.to_string() }).is_err()
                        }
                        None => {
                            on_event.send(WsEvent::Close { code: 1006, reason: "closed".into() }).is_err()
                        }
                    };
                    if dead { break; }
                }
                _ = shutdown_rx.recv() => {
                    let _ = on_event.send(WsEvent::Close { code: 1000, reason: "closed by client".into() });
                    break;
                }
            }
        }
        // 任何退出路径都清理:drop stream(读半部)+ 从 map 移除(drop sink 写半部)。
        println!("[ws] reader ended: {conn_id}");
        manager.remove(&conn_id);
    });

    Ok(WsConnectResult { connection_id })
}

/// 按连接发二进制帧(base64 解码)。连接不存在 → Err(前端吞掉)。
#[tauri::command]
pub async fn ws_send(
    connection_id: String,
    payload: String,
    state: State<'_, Arc<WsManager>>,
) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload)
        .map_err(|e| e.to_string())?;
    // 只 clone Arc,drop std 互斥锁再 await —— 跨连接无锁竞争,无死锁。
    let sink = {
        let conns = state.conns.lock().map_err(|e| e.to_string())?;
        conns
            .get(&connection_id)
            .ok_or_else(|| format!("ws connection not found: {connection_id}"))?
            .sink
            .clone()
    };
    let mut guard = sink.lock().await;
    guard
        .send(Message::Binary(bytes))
        .await
        .map_err(|e| e.to_string())
}

/// 关闭指定连接(前端退订)。幂等:task 已退时 shutdown_tx.send 返回 Err 被 `let _` 吸收。
#[tauri::command]
pub async fn ws_close(connection_id: String, state: State<'_, Arc<WsManager>>) -> Result<(), String> {
    // 从 map 移除即 drop 掉 sink(写半部,socket 写侧关闭);再发退订信号让 reader task
    // 结束并 drop 读半部。
    let shutdown_tx = {
        let mut conns = state.conns.lock().map_err(|e| e.to_string())?;
        conns.remove(&connection_id).map(|c| c.shutdown_tx)
    };
    if let Some(tx) = shutdown_tx {
        println!("[ws] close: {connection_id}");
        let _ = tx.send(()).await;
    }
    Ok(())
}
