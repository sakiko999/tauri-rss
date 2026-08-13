/**
 * nodeWsBackend — Node 环境 WsBackend 实现,用 `ws` npm 包建立带自定义 header
 * 的 WebSocket(浏览器/undici 原生 WS 都带不了 header)。供 example / 测试脚本
 * 验证 douyin 等平台的弹幕(握手需 UA/Cookie/Origin)。
 *
 * Node ≥22 的原生 WebSocket 遵循浏览器规范,无法自定义 header —— 这就是必须
 * 用 `ws` 包的原因。desktop 生产走 Rust 隧道(TauriWsBackend),本实现仅供
 * example 调试。
 */
import WebSocket from "ws"

class NodeWsConnection implements WsConnection {
  constructor(private ws: WebSocket, readonly connectionId: string) {}
  get readyState(): number {
    // ws 包:0 CONNECTING / 1 OPEN / 2 CLOSING / 3 CLOSED,与 WebSocket 常量对齐。
    return this.ws.readyState
  }
  send(data: Uint8Array): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(data)
  }
  close(): void {
    this.ws.close()
  }
}

export function nodeWsBackend(): WsBackend {
  let nextId = 0
  return {
    async connect(opts: WsConnectOptions): Promise<WsConnection> {
      const ws = new WebSocket(opts.url, { headers: opts.headers })
      const connectionId = `node-ws-${nextId++}`
      const conn = new NodeWsConnection(ws, connectionId)
      ws.on("open", () => opts.onOpen?.(conn))
      ws.on("message", (data) => {
        // ws 包默认 binaryType 是 nodebuffer,message 回调 data 是 Buffer。
        // ⚠️ 不要设 ws.binaryType="arraybuffer" —— 那样 data 变 ArrayBuffer,下面
        // buf.buffer 访问不到(undefined → 空 Uint8Array,帧长度 0)。统一转 Uint8Array。
        const buf = data as Buffer
        opts.onMessage(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), conn)
      })
      ws.on("close", (code, reason) => opts.onClose?.(code, reason.toString()))
      ws.on("error", (e) => opts.onClose?.(1006, e.message))
      return conn
    },
  }
}
