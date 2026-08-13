/**
 * ws —— 弹幕 WebSocket 通用封装。
 *
 * 四平台弹幕(channels 各平台 danmaku)共用:订阅即建连、退订即断开;
 * 断线指数退避重连(不依赖 React 生命周期);心跳定时;认证帧在 onopen 发。
 * 差异只在「帧编解码」——每平台提供 onMessage(ArrayBuffer → DanmakuItem[])。
 *
 * 连接层:优先走 `globalThis.appHost.ws`(桌面 Rust ws_connect / node ws 包,
 * 握手可带自定义 header——douyin 需要 UA/Cookie/Origin);未注入(纯浏览器调试)
 * 兜底原生 `new WebSocket`(无自定义 header)。bili live/douyu/huya 原生无 header
 * 可连;douyin 必须走宿主隧道。两形态在内部归一成 WsLike 抽象(send/close/readyState)。
 */
import type { DanmakuItem, DanmakuStream } from "../index.ts"

export interface WsStreamOptions {
  url: string
  /** 自定义握手 header(透传给宿主 ws;douyin 带 UA/Cookie/Origin)。 */
  headers?: Record<string, string>
  /** 握手超时,ms(宿主 ws 用)。 */
  timeoutMs?: number
  /** 连接建立后调用(发认证帧)。 */
  onOpen?: (ws: WebSocket) => void
  /** 每帧解码 → 弹幕。可异步(如 bilibili 的 brotli DecompressionStream)。
   *  第二参 ws:用于回执(douyin 的 ack),其余平台忽略。 */
  onMessage: (data: ArrayBuffer, ws: WebSocket) => DanmakuItem[] | Promise<DanmakuItem[]>
  /** 心跳帧(定时发送)。 */
  heartbeat?: () => Uint8Array
  heartbeatMs?: number
  /** 自定义连接(默认走 appHost.ws,缺失时原生 WebSocket)。 */
  connect?: () => WebSocket
  /** 断线重连最大延迟,ms(指数退避 1s→2s→4s…)。 */
  maxReconnectMs?: number
  /** 连接关闭回调(排查握手失败/被拒)。 */
  onClose?: (code: number, reason: string) => void
}

/** 连接统一抽象:原生 WebSocket 与宿主 WsConnection 都满足。 */
interface WsLike {
  readonly readyState: number
  send(data: Uint8Array): void
  close(): void
}

/** 创建弹幕 WS 流(订阅即建连)。 */
export function createWsStream(opts: WsStreamOptions): DanmakuStream {
  return (onItems) => {
    let stopped = false
    let ws: WsLike | null = null
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let attempts = 0

    const clearHeartbeat = (): void => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer)
        heartbeatTimer = null
      }
    }
    const send = (data: Uint8Array): void => {
      if (ws && ws.readyState === 1 /* OPEN */) {
        ws.send(data)
      }
    }

    /** 连接就绪(open)后:发 onOpen 认证帧 + 启动心跳。 */
    function onReady(conn: WsLike): void {
      attempts = 0
      opts.onOpen?.(conn as unknown as WebSocket)
      if (opts.heartbeat) {
        const hb = (): void => {
          if (!stopped) send(opts.heartbeat!())
        }
        hb()
        heartbeatTimer = setInterval(hb, opts.heartbeatMs ?? 30000)
      }
    }

    function connect(): void {
      if (stopped) return
      const host = globalThis.appHost.ws

      // 宿主 ws(桌面/Node):async 建连,握手失败 reject → 重连。
      if (host) {
        void host
          .connect({
            url: opts.url,
            headers: opts.headers,
            timeoutMs: opts.timeoutMs,
            onOpen: (conn) => {
              ws = conn as unknown as WsLike
              onReady(conn as unknown as WsLike)
            },
            onMessage: (data, conn) => {
              void Promise.resolve(opts.onMessage(data as unknown as ArrayBuffer, conn as unknown as WebSocket)).then(
                (items) => {
                  if (!stopped && items.length) onItems(items)
                },
              )
            },
            onClose: (code, reason) => {
              clearHeartbeat()
              opts.onClose?.(code, reason)
              if (!stopped) scheduleReconnect()
            },
          })
          .catch(() => {
            if (!stopped) scheduleReconnect()
          })
        return
      }

      // 原生 WebSocket 兜底(纯浏览器调试;不能带自定义 header)。
      try {
        ws = (opts.connect ? opts.connect() : new WebSocket(opts.url)) as unknown as WsLike
      } catch {
        scheduleReconnect()
        return
      }
      const raw = ws as unknown as WebSocket
      raw.binaryType = "arraybuffer"
      raw.onopen = () => onReady(raw as unknown as WsLike)
      raw.onmessage = (ev) => {
        const data = ev.data as ArrayBuffer
        void Promise.resolve(opts.onMessage(data, raw)).then((items) => {
          if (!stopped && items.length) onItems(items)
        })
      }
      raw.onclose = (ev) => {
        clearHeartbeat()
        opts.onClose?.(ev.code, ev.reason)
        if (!stopped) scheduleReconnect()
      }
      raw.onerror = () => {
        // onclose 跟随触发,重连逻辑在 onclose。
      }
    }

    function scheduleReconnect(): void {
      if (stopped) return
      const delay = Math.min(1000 * 2 ** attempts, opts.maxReconnectMs ?? 30000)
      attempts += 1
      reconnectTimer = setTimeout(connect, delay)
    }

    connect()

    // 退订:断开 WS + 清心跳/重连定时器(「退订即断开」)。
    return () => {
      stopped = true
      clearHeartbeat()
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (ws) {
        try {
          ws.close()
        } catch {
          /* noop */
        }
      }
    }
  }
}
