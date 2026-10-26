/**
 * CdpChannel —— 一条 CDP ws 连接的**连接级状态**（与载具无关）。
 *
 * 默认 page 与每个 lane tab 各持一个实例 —— 这是 lane 互不串台的根本:
 * 事件帧只来自本连接的 target，abortPending 只掐本连接。
 * 传输差异（Tauri 隧道 / Node ws）由 CdpConnector 吸收，本文件只认文本帧。
 */
import { browserLog } from "../log.ts"
import type { CdpConnector, CdpTransport } from "./transport.ts"

/**
 * 单条 CDP 命令的硬超时。远大于页面内任何有意义的操作(导航 ~20s、轮询 15s)，
 * 只在「回复永久丢失」时才触发——见 rawSend() 里的注释。
 */
export const CDP_CMD_TIMEOUT_MS = 30_000

/** 后台级「有浏览器操作在途」计数：空闲关闭只在零在途时执行。 */
export interface CdpActivity {
  begin: () => void
  end: () => void
}

export type CdpEventListener = (method: string, params: unknown, sessionId?: string) => void

export class CdpChannel {
  private transport: CdpTransport | null = null
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private nextId = 1
  private eventListeners = new Set<CdpEventListener>()
  private connecting: Promise<void> | null = null
  /** 本连接是否已挂上资源拦截(重连后要重挂)。 */
  private armed = false

  constructor(
    private readonly tag: string,
    private readonly connector: CdpConnector,
    private readonly activity?: CdpActivity,
  ) {}

  /**
   * 中止所有在途 invoke:把 pending 的 CDP 命令逐一 reject(让 send 立刻返回错误,
   * 而不是等到 CDP_CMD_TIMEOUT_MS),并断开连接。
   *
   * ⚠️ 底层传输本身无法真正取消(没有 abort 通道),所以这里做的是
   * 「不再等待」而非「停止执行」—— 对上层足够:等待者立刻拿到错误、释放锁,
   * 迟到的回复到达时 pending 里已无对应 id,按无主回复丢弃。
   */
  abortPending(reason: string): void {
    const err = new Error(reason)
    for (const [, p] of this.pending) p.reject(err)
    this.pending.clear()
    const transport = this.transport
    if (transport) {
      this.transport = null
      this.armed = false // 新连接要重挂资源拦截
      void transport.close().catch(() => {})
    }
  }

  /** 惰性建连(首次 send/evaluate 时)。openWs 由持有方提供(默认页 / tab target)。 */
  async ensureConn(openWs: () => Promise<string>): Promise<void> {
    if (this.transport) return
    if (!this.connecting) {
      this.connecting = (async () => {
        const wsUrl = await openWs()
        this.transport = await this.connector.connect(wsUrl, {
          onText: (text) => this.handleText(text),
          // ⚠️ ws 断开必须让连接失效：否则 transport 永远非空，`ensureConn` 直接早退，
          // openWs 的 target 自愈链永远走不到。浏览器被空闲回收/崩溃后，每次 evaluate 都
          // 在 send 处失败(waitUntil 还会把错误当「页面未就绪」重试,烧满超时)。
          // abortPending 会 reject 在途命令、清 transport、置 armed=false，下次调用重新建连。
          onClose: (reason) => this.abortPending(reason),
        })
      })().finally(() => {
        this.connecting = null
      })
    }
    return this.connecting
  }

  /** 发一条 CDP 命令(公开入口;惰性建连由持有方先做)。 */
  async send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<unknown> {
    return this.rawSend(method, params, sessionId)
  }

  /**
   * 给本连接挂上资源拦截(每个 target / 每次重连各一次)。
   * 失败不致命:只是少了这层优化,下次重连再试。
   */
  async armNetwork(urls: string[]): Promise<void> {
    if (!this.transport || this.armed) return
    this.armed = true
    try {
      await this.rawSend("Network.enable", {})
      await this.rawSend("Network.setBlockedURLs", { urls })
    } catch (e) {
      this.armed = false
      browserLog.armFailed({ detail: e instanceof Error ? e.message : String(e) })
    }
  }

  /** 订阅 CDP 事件（无 id 的帧），返回取消订阅函数。 */
  onEvent(cb: CdpEventListener): () => void {
    this.eventListeners.add(cb)
    return () => {
      this.eventListeners.delete(cb)
    }
  }

  /** 发一条 CDP 命令(文本帧),等匹配 id 的响应。 */
  private rawSend(method: string, params: Record<string, unknown>, sessionId?: string): Promise<unknown> {
    const transport = this.transport
    if (!transport) return Promise.reject(new Error(`CDP not connected(${this.tag})`))
    const id = this.nextId++
    const msg = JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })
    // 每条在途命令都算「有操作」:空闲关闭只会在零在途时触发。
    this.activity?.begin()
    return new Promise((resolve, reject) => {
      // ⚠️ 单条命令超时是必须的:页面在命令未回话时被导航/替换,该 id 的回复会
      // **永久丢失**,promise 就此永不 settle。后果不是「这一条卡住」而是全线卡死:
      // waitUntil 的 deadline 只在两次 evaluate 之间检查,单次 evaluate 挂住就轮不到
      // 超时判断(它的 timeoutMs 形同虚设)→ lane 锁永不释放 → 整轮 refreshAll 不结束
      // (顶栏「更新中」永久转圈)。超时把「无限等待」降级成「这条命令报错」。
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          this.activity?.end()
          reject(new Error(`CDP 命令超时(${method}):页面可能已导航,回复丢失`))
        }
      }, CDP_CMD_TIMEOUT_MS)
      const settle = <T>(fn: (v: T) => void) => (v: T) => {
        clearTimeout(timer)
        this.activity?.end()
        fn(v)
      }
      this.pending.set(id, { resolve: settle(resolve), reject: settle(reject) })
      void transport.send(msg).catch((e) => {
        if (!this.pending.delete(id)) return
        clearTimeout(timer)
        this.activity?.end()
        reject(e instanceof Error ? e : new Error(String(e)))
      })
    })
  }

  private handleText(text: string): void {
    const msg = JSON.parse(text) as {
      id?: number
      method?: string
      params?: unknown
      sessionId?: string
      error?: unknown
      result?: unknown
    }
    if (msg.id === undefined) {
      // 事件帧(无 id)：分发给订阅者（Network.* / Target.* 等）——仅本连接 target 的。
      if (msg.method) for (const cb of this.eventListeners) cb(msg.method, msg.params, msg.sessionId)
      return
    }
    const p = this.pending.get(msg.id)
    if (!p) return
    this.pending.delete(msg.id)
    if (msg.error) p.reject(new Error(`CDP ${JSON.stringify(msg.error)}`))
    else p.resolve(msg.result)
  }

  async closeWs(): Promise<void> {
    const transport = this.transport
    if (!transport) return
    this.transport = null
    this.armed = false
    await transport.close().catch(() => {})
  }
}
