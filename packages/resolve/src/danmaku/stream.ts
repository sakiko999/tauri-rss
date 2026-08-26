/**
 * stream —— 弹幕流原语:异步 setup 竞态守卫(deferredStream)+ WS 连接管理(createWsStream)。
 *
 * 两个原语都是「构造 DanmakuStream」的基础层,各平台弹幕按需组合:
 *   - deferredStream:异步 setup(ensureCookie / enter 长号 / getDanmuInfo / 页面解析)→
 *     建流的 stopped 守卫(setup 完成前已退订则不再建流,连接零泄漏)。bili VOD 只用它。
 *   - createWsStream:WS 连接生命周期(订阅即建连、退订即断开、指数退避重连、心跳、
 *     认证帧在 onopen 发)。四平台直播弹幕(bili/douyu/huya/douyin)共用,配合
 *     deferredStream 组合(先异步 setup 再建 WS)。
 *
 * 连接层:统一走 `globalThis.appHost.ws`(桌面 Rust ws_connect / node ws 包,
 * 握手可带自定义 header——douyin 需要 UA/Cookie/Origin);原生 WebSocket 仅兜底
 * 无宿主环境(纯浏览器调试,无自定义 header)。曾按 opts.headers 分流——「douyu
 * danmuproxy:8506 schannel 证书校验失败」走原生;2026-08-14 probe 实测 native-tls
 * 连 douyu 8/8 握手成功(证书 GlobalSign 有效,失败实为集群节点偶发 RST),故统一
 * 走宿主。两形态在内部归一成 WsLike 抽象(send/close/readyState)。
 */
import type { DanmakuItem, DanmakuStream } from "./types.ts"
import { log } from "../log.ts"

export interface WsStreamOptions {
  url: string
  /** 自定义握手 header(透传给宿主 ws;douyin 带 UA/Cookie/Origin)。 */
  headers?: Record<string, string>
  /** 握手超时,ms(宿主 ws 用)。 */
  timeoutMs?: number
  /** 连接建立后调用(发认证帧)。ws 是 WsLike,直接 send(Uint8Array) 免断言。 */
  onOpen?: (ws: WsLike) => void
  /** 每帧解码 → 弹幕。可异步(如 bilibili 的 brotli DecompressionStream)。
   *  第二参 ws:用于回执(douyin 的 ack),其余平台忽略。 */
  onMessage: (data: ArrayBuffer, ws: WsLike) => DanmakuItem[] | Promise<DanmakuItem[]>
  /** 心跳帧(定时发送)。 */
  heartbeat?: () => Uint8Array
  heartbeatMs?: number
  /** 断线重连最大延迟,ms(指数退避 1s→2s→4s…)。 */
  maxReconnectMs?: number
  /** 连接关闭回调(排查握手失败/被拒)。 */
  onClose?: (code: number, reason: string) => void
}

/** 连接统一抽象:原生 WebSocket 与宿主 WsConnection 都满足。onOpen/onMessage 暴露它,免断言直接 send(Uint8Array)。 */
export interface WsLike {
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
    const safeClose = (conn: WsLike): void => {
      try {
        conn.close()
      } catch {
        /* noop */
      }
    }

    /** 连接就绪(open)后:发 onOpen 认证帧 + 启动心跳。 */
    function onReady(conn: WsLike): void {
      attempts = 0
      log.danmaku.wsOpen({ url: opts.url })
      opts.onOpen?.(conn)
      if (opts.heartbeat) {
        const hb = (): void => {
          if (!stopped) send(opts.heartbeat!())
        }
        hb()
        heartbeatTimer = setInterval(hb, opts.heartbeatMs ?? 30000)
      }
    }

    /** 帧分发统一入口(宿主/原生共用):解码 → 过滤已退订/空 → 上报。 */
    function deliver(data: ArrayBuffer, conn: WsLike): void {
      // 快路径:同步解码器(huya/douyu)不经微任务;异步(brotli/ack)才包 Promise。
      const result = opts.onMessage(data, conn)
      const report = (items: DanmakuItem[]): void => {
        if (!stopped && items.length) {
          log.danmaku.wsItems({ count: items.length })
          onItems(items)
        }
      }
      if (result instanceof Promise) void result.then(report)
      else report(result)
    }

    /** 连接关闭统一入口:清心跳 + 意外断线 warn + 重连(主动退订的提示在 unsub 统一打)。 */
    function handleClose(code: number, reason: string): void {
      clearHeartbeat()
      if (!userClosed) log.danmaku.wsClosed({ code, reason })
      opts.onClose?.(code, reason)
      if (!stopped) scheduleReconnect()
    }

    /** open 统一入口:退订后握手才完成(异步 connect)时拦截,立即关闭刚建的连接。 */
    function handleOpen(conn: WsLike): void {
      if (stopped) {
        safeClose(conn)
        return
      }
      ws = conn
      onReady(conn)
    }

    function connect(): void {
      if (stopped) return
      log.danmaku.wsConnect({ url: opts.url })
      const host = globalThis.appHost.ws

      if (host) {
        void host
          .connect({
            url: opts.url,
            headers: opts.headers,
            timeoutMs: opts.timeoutMs,
            onOpen: (conn) => handleOpen(conn as unknown as WsLike),
            onMessage: (data, conn) => deliver(data as unknown as ArrayBuffer, conn as unknown as WsLike),
            onClose: handleClose,
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
        ws = new WebSocket(opts.url) as unknown as WsLike
      } catch (e) {
        log.danmaku.wsHandshakeError({ message: (e as Error)?.message ?? String(e) })
        scheduleReconnect()
        return
      }
      const raw = ws as unknown as WebSocket
      raw.binaryType = "arraybuffer"
      raw.onopen = () => handleOpen(raw as unknown as WsLike)
      raw.onmessage = (ev) => deliver(ev.data as ArrayBuffer, raw as unknown as WsLike)
      raw.onclose = (ev) => handleClose(ev.code, ev.reason)
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
      if (ws) safeClose(ws)
    }
  }
}

/**
 * 异步 setup + build 组合成 DanmakuStream。
 * [setup] 异步探测(返回 build 所需的参数);[build] setup 成功后建流,返回退订函数
 * (或 void);[onError] setup/build 失败回调(不传则静默吞掉)。
 * 退订在 setup 未完成时置 stopped,完成后不再建流——连接零泄漏。
 */
export function deferredStream<T>(
  setup: () => Promise<T>,
  build: (value: T, onItems: (items: DanmakuItem[]) => void) => (() => void) | void,
  onError?: (error: unknown) => void,
): DanmakuStream {
  return (onItems) => {
    let stopped = false
    let unsub: (() => void) | undefined
    void setup()
      .then((value) => {
        if (stopped) return
        const u = build(value, onItems)
        if (u) unsub = u
      })
      .catch((e) => {
        if (!stopped) onError?.(e)
      })
    return () => {
      stopped = true
      unsub?.()
    }
  }
}
