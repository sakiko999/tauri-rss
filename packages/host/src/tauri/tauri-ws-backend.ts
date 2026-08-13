/**
 * TauriWsBackend — WsBackend 实现,通过 Rust `ws_connect`/`ws_send`/`ws_close`
 * (tokio-tungstenite)隧道 WebSocket。握手可带自定义 header(UA/Cookie/Origin),
 * 二进制帧走 base64(与 http_get 的 arraybuffer 约定一致)。
 *
 * Rust 侧 `commands/ws.rs`:ws_connect 先握手成功才返回 connectionId(失败 reject);
 * 消息经 `Channel<WsEvent>` 回传(Binary/Close/Error)。前端退订调 close →
 * Rust 移除连接 + 终止 reader task(Channel 被 GC 也会让 Rust 侧 send 失败自终止)。
 *
 * ⚠️ Open 事件不依赖 Rust 的 `WsEvent::Open`(先于 invoke resolve 到达,conn 未赋值,
 * onOpen(undefined) 会导致认证帧/心跳发不出)——握手成功即连接就绪,connect resolve
 * 后主动触发 onOpen。见下方注释。
 */
import { invoke, Channel } from "@tauri-apps/api/core"

/** 与 Rust `commands/ws.rs` 的 `WsEvent`(serde tag/content)对齐。 */
interface WsEventMsg {
  event: "Open" | "Binary" | "Close" | "Error"
  data?: unknown
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}
function bytesToBase64(bytes: Uint8Array): string {
  let bin = ""
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

class TauriWsConnection implements WsConnection {
  readyState: number = 1 // ws_connect 在握手成功后 resolve,生来即 OPEN
  constructor(readonly connectionId: string) {}
  send(data: Uint8Array): void {
    void invoke("ws_send", { connectionId: this.connectionId, payload: bytesToBase64(data) }).catch(() => {})
  }
  close(): void {
    this.readyState = 3
    void invoke("ws_close", { connectionId: this.connectionId }).catch(() => {})
  }
}

export class TauriWsBackend implements WsBackend {
  async connect(opts: WsConnectOptions): Promise<WsConnection> {
    let conn!: TauriWsConnection
    const onEvent = new Channel<WsEventMsg>()
    onEvent.onmessage = (ev) => {
      switch (ev.event) {
        // "Open" 忽略——Rust ws_connect 先 send Open 再返回 connectionId,Channel 事件
        // 可能先于 invoke resolve 到达,此时 conn 未赋值 → opts.onOpen(undefined) →
        // 认证帧/心跳发不出(douyin 弹幕实测:连接建立后服务器不发数据,静默挂着)。
        // 握手成功 = 连接就绪,由下方 invoke resolve 后主动触发 onOpen(conn 已赋值)。
        case "Binary":
          opts.onMessage(base64ToBytes(ev.data as string), conn)
          break
        case "Close": {
          const c = ev.data as { code?: number; reason?: string }
          conn.readyState = 3
          opts.onClose?.(c.code ?? 1006, c.reason ?? "")
          break
        }
        case "Error":
          opts.onClose?.(1006, (ev.data as { message?: string }).message ?? "")
          break
      }
    }
    // 握手失败(Rust Err)→ invoke reject → createWsStream 的 connect try/catch → 重连。
    const res = await invoke<{ connectionId: string }>("ws_connect", {
      req: { url: opts.url, headers: opts.headers ?? {}, timeoutMs: opts.timeoutMs ?? 20000 },
      onEvent,
    })
    conn = new TauriWsConnection(res.connectionId)
    // 主动触发 onOpen:此时 conn 已赋值,认证帧/心跳可靠发送。
    opts.onOpen?.(conn)
    return conn
  }
}
