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
import { log } from "../log.ts"

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
    /** 主动退订标志:onClose 区分「正常关闭直播间」vs「意外断线」。 */
    let userClosed = false
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
      log.danmaku.wsOpen({ url: opts.url })
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
      log.danmaku.wsConnect({ url: opts.url })
      const host = globalThis.appHost.ws

      // ⚠️ 有宿主(wss: Rust ws_connect / node ws 包)一律走宿主隧道,统一实现。
      // 原生 WebSocket 只留给无宿主环境(纯浏览器调试 injectBrowserHost 无 ws)。
      // 历史:曾按 opts.headers 分流——「douyu danmuproxy:8506 schannel 证书校验
      // 失败」走原生;2026-08-14 probe 实测 native-tls 连 douyu 8/8 握手成功
      // (证书 GlobalSign 有效,失败实为集群节点偶发 RST),故统一走宿主。
      const needHost = !!host
      if (needHost) {
        void host!
          .connect({
            url: opts.url,
            headers: opts.headers,
            timeoutMs: opts.timeoutMs,
            onOpen: (conn) => {
              // ⚠️ 退订后握手才完成(宿主 ws_connect 异步):stopped 已 true → 立即关闭
              // 刚建立的连接,否则认证帧/心跳照发,连接泄漏(关闭直播间弹幕不释放)。
              if (stopped) {
                try {
                  (conn as unknown as WsLike).close()
                } catch {
                  /* noop */
                }
                return
              }
              ws = conn as unknown as WsLike
              onReady(conn as unknown as WsLike)
            },
            onMessage: (data, conn) => {
              void Promise.resolve(opts.onMessage(data as unknown as ArrayBuffer, conn as unknown as WebSocket)).then(
                (items) => {
                  if (!stopped && items.length) {
                    log.danmaku.wsItems({ count: items.length })
                    onItems(items)
                  }
                },
              )
            },
            onClose: (code, reason) => {
              clearHeartbeat()
              // 主动退订的提示在 unsub 统一打(不依赖 onClose 事件——部分平台/连接
              // 状态 onClose 不触发,会静默);此处只对意外断线打 warn。
              if (!userClosed) log.danmaku.wsClosed({ code, reason })
              opts.onClose?.(code, reason)
              if (!stopped) scheduleReconnect()
            },
          })
          .then((conn) => {
            // 兜底:握手完成后若已退订(正常路径 onOpen 的 stopped 分支已 close,
            // 但后端若未调 onOpen 则这里兜底),确保连接关闭不泄漏。
            if (stopped && conn) {
              try {
                (conn as unknown as WsLike).close()
              } catch {
                /* noop */
              }
            }
          })
          .catch((e) => {
            // 握手失败原因(douyin 415 / TLS 证书 / HTTP 拒绝)——之前被吞,重连循环无迹可循。
            log.danmaku.wsHandshakeError({ message: (e as Error)?.message ?? String(e) })
            if (!stopped) scheduleReconnect()
          })
        return
      }

      // 原生 WebSocket(webview / 纯浏览器调试;不能带自定义 header)。
      try {
        ws = (opts.connect ? opts.connect() : new WebSocket(opts.url)) as unknown as WsLike
      } catch (e) {
        log.danmaku.wsHandshakeError({ message: (e as Error)?.message ?? String(e) })
        scheduleReconnect()
        return
      }
      const raw = ws as unknown as WebSocket
      raw.binaryType = "arraybuffer"
      raw.onopen = () => {
        // 原生 WS 也同竞态:退订后 open 才触发 → 立即关闭。
        if (stopped) {
          try {
            raw.close()
          } catch {
            /* noop */
          }
          return
        }
        onReady(raw as unknown as WsLike)
      }
      raw.onmessage = (ev) => {
        const data = ev.data as ArrayBuffer
        void Promise.resolve(opts.onMessage(data, raw)).then((items) => {
          if (!stopped && items.length) {
            log.danmaku.wsItems({ count: items.length })
            onItems(items)
          }
        })
      }
      raw.onclose = (ev) => {
        clearHeartbeat()
        if (!userClosed) log.danmaku.wsClosed({ code: ev.code, reason: ev.reason })
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
      log.danmaku.wsReconnect({ attempt: attempts, delayMs: delay })
      reconnectTimer = setTimeout(connect, delay)
    }

    connect()

    // 退订:断开 WS + 清心跳/重连定时器(「退订即断开」)。
    // ⚠️ 主动退订的提示在这里打(unsub 同步执行,必然触发)——不能依赖 onClose 事件:
    // 部分平台服务器优雅关闭时 onClose 不触发(或连接已断 ws 为 null),会静默无日志。
    return () => {
      stopped = true
      userClosed = true
      log.danmaku.wsClosedByUser()
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
