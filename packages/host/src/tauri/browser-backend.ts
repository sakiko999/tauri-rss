/**
 * TauriBrowserBackend — BrowserBackend 实现,CDP 附加真实 Edge(生产浏览器模拟)。
 *
 * 微博/小红书反爬强,需真实浏览器提供登录态 + JS 签名(_webmsxyw)+ 设备指纹。
 * ⚠️ 本分支(feat/webview2-browser)用 Tauri 自己的 WebView2 当抓取浏览器:
 * Rust `webview_browser_open` 建一个隐藏 webview(独立 data_directory + CDP 9334),
 * 不再 spawn 系统 Edge。本后端只认端口,与浏览器是谁无关:
 *   1. invoke browser_ensure → 拿 CDP 端口;
 *   2. GET /json/list → 找第一个 page target 的 webSocketDebuggerUrl(默认 lane);
 *   3. invoke ws_connect(文本帧)——CDP 是 JSON 文本帧,不走弹幕二进制隧道,
 *      自己管理 connectionId + 消息 id 递增的 pending map;
 *   4. evaluate = Runtime.evaluate(awaitPromise + returnByValue)。
 *
 * lane 化(风控 §3.13):`tab(key)` 为每个 lane 建独立 target(`PUT /json/new`) +
 * 独立 ws 连接(CdpChannel 各持 pending/事件),列表/详情/登录互不抢页面;
 * cookie 是浏览器级共享的。tab 有 LRU 上限(超限关最久未用的 lane,下次用重建)。
 *
 * ⚠️ ws.rs 的 ws_send 已支持 text=true(CDP 用),弹幕二进制调用不受影响。
 */
import { invoke, Channel } from "@tauri-apps/api/core"
import { browserLog } from "../log.ts"

/** 与 ws.rs WsEvent(tag/content)对齐;CDP 走 Text 帧。 */
interface CdpEventMsg {
  event: "Text" | "Close" | "Error" | "Open" | "Binary"
  data?: unknown
}

/** btoa 只支持 Latin1;CDP 消息可能含中文(URL/签名/页面文本),先 UTF-8 编码再 base64。 */
function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let bin = ""
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function fromBase64(b64: string): string {
  const bin = atob(b64)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/**
 * 单条 CDP 命令的硬超时。远大于页面内任何有意义的操作(导航 ~20s、轮询 15s),
 * 只在「回复永久丢失」时才触发——见 rawSend() 里的注释。
 */
const CDP_CMD_TIMEOUT_MS = 30_000

/**
 * 资源拦截:字体/媒体/统计域名对抓取零价值(页面内容走 SSR HTML + 签名脚本 + cookie)。
 * **不拦 CSS** —— 布局一变,懒加载与可见性判定(IntersectionObserver)可能跟着变。
 * 图片已在启动参数层关掉(`--blink-settings=imagesEnabled=false`)。
 */
const BLOCKED_URL_PATTERNS = [
  "*.woff",
  "*.woff2",
  "*.ttf",
  "*.otf",
  "*.mp4",
  "*.m3u8",
  "*.webm",
  "*.mp3",
  "*.m4a",
  "*doubleclick.net*",
  "*google-analytics.com*",
  "*googletagmanager.com*",
  "*hm.baidu.com*",
  "*cnzz.com*",
  "*umeng.com*",
  "*sentry.io*",
]

/**
 * 空闲关闭:抓取实例活跃时约 0.9–1.0GB private(实测 2026-10-22),而抓取是间歇性的。
 * 零在途操作满 3 分钟就关掉(profile/登录态留在磁盘上),下次用自动重启(~1.5s)。
 * ⚠️ 10 分钟太长:一轮刷新结束后通常就没事了,而常驻的 1GB 对用户是实打实的。
 */
const IDLE_CLOSE_MS = 3 * 60_000

/** 后台级「有浏览器操作在途」计数:空闲关闭只在零在途时执行。 */
interface BrowserActivity {
  begin: () => void
  end: () => void
}

/** `/json/list` 的条目(只取用得到的字段)。 */
interface TargetInfo {
  id?: string
  type?: string
  url?: string
  webSocketDebuggerUrl?: string
}

/**
 * Edge 自带界面的 scheme。默认通道绝不挂上去，启动后也顺手关掉这些 target。
 * ⚠️ `about:` 不在此列 —— 那是我们自己的空白页。
 */
const EDGE_UI_URL = /^(edge|chrome|chrome-untrusted|devtools|chrome-extension):/i

/** Copilot 侧栏 iframe：实测独占一个 renderer、121MB private，抓取完全用不到。 */
const EDGE_UI_HOST = /^https?:\/\/copilot\.microsoft\.com\//i

function isEdgeUiTarget(t: TargetInfo): boolean {
  const url = t.url ?? ""
  return EDGE_UI_URL.test(url) || EDGE_UI_HOST.test(url)
}

type CdpEventListener = (method: string, params: unknown, sessionId?: string) => void

/**
 * 一条 CDP ws 连接的**连接级状态**(pending map / 消息 id / 在途 invoke / 事件订阅)。
 * 默认 page 与每个 lane tab 各持一个实例 —— 这是 lane 互不串台的根本:
 * 事件帧只来自本连接的 target,abortPending 只掐本连接。
 */
class CdpChannel {
  private connId: string | null = null
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private nextId = 1
  private inflight = new Set<Promise<unknown>>()
  private eventListeners = new Set<CdpEventListener>()
  private connecting: Promise<void> | null = null
  /** 本连接是否已挂上资源拦截(重连后要重挂)。 */
  private armed = false

  constructor(private readonly tag: string, private readonly activity?: BrowserActivity) {}

  /** 记一次 invoke 并在 settle 后自清(失败不影响调用方)。 */
  track<T>(p: Promise<T>): Promise<T> {
    this.inflight.add(p)
    const drop = () => this.inflight.delete(p)
    void p.then(drop, drop)
    return p
  }

  /**
   * 中止所有在途 invoke:把 pending 的 CDP 命令逐一 reject(让 send 立刻返回错误,
   * 而不是等到 CDP_CMD_TIMEOUT_MS),并断开连接。
   *
   * ⚠️ 底层 Rust invoke 本身无法真正取消(没有 abort 通道),所以这里做的是
   * 「不再等待」而非「停止执行」—— 对上层足够:等待者立刻拿到错误、释放锁,
   * 迟到的回复到达时 pending 里已无对应 id,按无主回复丢弃。
   */
  abortPending(reason: string): void {
    const err = new Error(reason)
    for (const [, p] of this.pending) p.reject(err)
    this.pending.clear()
    if (this.connId) {
      const id = this.connId
      this.connId = null
      this.armed = false // 新连接要重挂资源拦截
      void this.track(invoke("ws_close", { connectionId: id })).catch(() => {})
    }
  }

  /** 惰性建连(首次 send/evaluate 时)。openWs 由持有方提供(默认页 / tab target)。 */
  async ensureConn(openWs: () => Promise<string>): Promise<void> {
    if (this.connId) return
    if (!this.connecting) {
      this.connecting = (async () => {
        const wsUrl = await openWs()
        const onEvent = new Channel<CdpEventMsg>()
        onEvent.onmessage = (ev) => this.handleEvent(ev)
        const c = await this.track(
          invoke<{ connectionId: string }>("ws_connect", {
            req: { url: wsUrl, headers: {}, timeoutMs: 10_000 },
            onEvent,
          }),
        )
        this.connId = c.connectionId
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
  async armNetwork(): Promise<void> {
    if (!this.connId || this.armed) return
    this.armed = true
    try {
      await this.rawSend("Network.enable", {})
      await this.rawSend("Network.setBlockedURLs", { urls: BLOCKED_URL_PATTERNS })
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
    if (!this.connId) return Promise.reject(new Error(`CDP not connected(${this.tag})`))
    const id = this.nextId++
    const msg = JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })
    const payload = toBase64(msg)
    // 每条在途命令都算「有操作」:空闲关闭只会在零在途时触发(见 TauriBrowserBackend)。
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
      void this.track(invoke("ws_send", { connectionId: this.connId, payload, text: true })).catch((e) => {
        if (!this.pending.delete(id)) return
        clearTimeout(timer)
        this.activity?.end()
        reject(e instanceof Error ? e : new Error(String(e)))
      })
    })
  }

  private handleEvent(ev: CdpEventMsg): void {
    if (ev.event !== "Text") return
    const msg = JSON.parse(fromBase64(ev.data as string)) as {
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
    if (this.connId) {
      await this.track(invoke("ws_close", { connectionId: this.connId })).catch(() => {})
      this.connId = null
      this.armed = false
    }
  }
}

/** lane tab 的 LRU 上限(每 tab ≈60–120MB,不设上限内存不可控)。 */
const MAX_TABS = 8

/** lane tab 句柄:独立 target(PUT /json/new)+ 独立 CdpChannel。 */
class TauriBrowserTab implements BrowserTab {
  private channel: CdpChannel
  private targetId: string | null = null
  private ensuring: Promise<void> | null = null

  constructor(
    readonly key: string,
    private readonly getPort: () => Promise<number>,
    activity: BrowserActivity,
  ) {
    this.channel = new CdpChannel(`tab:${key}`, activity)
  }

  /** 确保 target 存在(一次;PUT /json/new 建**同窗口 tab**,不开新窗口)。 */
  private ensureTarget(): Promise<void> {
    if (this.targetId) return Promise.resolve()
    if (!this.ensuring) {
      this.ensuring = (async () => {
        const port = await this.getPort()
        // Chromium ≥111 要求 PUT;about:blank 落点由 cdpNavigate 决定。
        const res = await globalThis.appHost.http.request({
          url: `http://127.0.0.1:${port}/json/new?about:blank`,
          method: "PUT",
          responseType: "text",
          timeoutMs: 5_000,
        })
        const t = JSON.parse(String(res.body)) as { id?: string }
        if (!t.id) throw new Error("CDP: /json/new 未返回 target id")
        this.targetId = t.id
      })().finally(() => {
        this.ensuring = null
      })
    }
    return this.ensuring
  }

  /** 本 tab 的 ws 端点(target 的 webSocketDebuggerUrl)。target 丢失时自愈重建一次。 */
  private async openWs(): Promise<string> {
    await this.ensureTarget()
    const port = await this.getPort()
    // /json/list 里按 id 找本 target(拿最新 webSocketDebuggerUrl;重连安全)。
    const list = async () => {
      const res = await globalThis.appHost.http.request({
        url: `http://127.0.0.1:${port}/json/list`,
        method: "GET",
        responseType: "text",
        timeoutMs: 5_000,
      })
      return JSON.parse(String(res.body)) as Array<{ id?: string; webSocketDebuggerUrl?: string }>
    }
    let targets = await list()
    let t = targets.find((x) => x.id === this.targetId && x.webSocketDebuggerUrl)
    if (!t?.webSocketDebuggerUrl) {
      // target 随浏览器重启/profile 重置消失:清掉旧 id 重建一个(BrowserTab 契约
      // 要求「可校验、可重建」,否则该 lane 会永久报 'target 已消失')。
      this.targetId = null
      await this.ensureTarget()
      targets = await list()
      t = targets.find((x) => x.id === this.targetId && x.webSocketDebuggerUrl)
    }
    if (!t?.webSocketDebuggerUrl) throw new Error(`CDP: lane tab ${this.key} 的 target 已消失`)
    return t.webSocketDebuggerUrl
  }

  private async ensureConn(): Promise<void> {
    await this.channel.ensureConn(() => this.openWs())
    await this.channel.armNetwork()
  }

  async evaluate<T = unknown>(
    expression: string,
    opts?: { awaitPromise?: boolean; returnByValue?: boolean },
  ): Promise<T> {
    await this.ensureConn()
    const r = (await this.channel.send("Runtime.evaluate", {
      expression,
      awaitPromise: opts?.awaitPromise ?? true,
      returnByValue: opts?.returnByValue ?? true,
    })) as { exceptionDetails?: unknown; result?: { value?: unknown } }
    if (r.exceptionDetails) {
      const d = (r.exceptionDetails as { text?: string; exception?: { description?: string } }).exception
      const detail = d?.description ?? JSON.stringify(r.exceptionDetails)
      browserLog.evalError({ expression, detail })
      throw new Error(`CDP evaluate 异常: ${detail}`)
    }
    return r.result?.value as T
  }

  async getCookies(url?: string): Promise<Record<string, string>> {
    await this.ensureConn()
    const r = (url
      ? await this.channel.send("Network.getCookies", { urls: [url] })
      : await this.channel.send("Network.getAllCookies", {})
    ) as { cookies?: Array<{ name: string; value: string }> }
    const out: Record<string, string> = {}
    for (const c of r.cookies ?? []) out[c.name] = c.value
    return out
  }

  async send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<unknown> {
    // ⚠️ 必须惰性建连(与 backend.send 对齐):capturePage 的第一条命令就是
    // send("Network.enable"),而 withBrowserOp 的 hidden 分支不会先 evaluate ——
    // 缺这一行时新建的 lane tab 首条命令直接 "CDP not connected",被动渠道每次刷新
    // 都回退缓存报错(审查发现,2026-10-22)。
    await this.ensureConn()
    return this.channel.send(method, params, sessionId)
  }

  onEvent(cb: CdpEventListener): () => void {
    return this.channel.onEvent(cb)
  }

  /** 激活本 tab(毫秒级、不重载)——滚动驱动前必须(非激活 tab rAF/IO 停摆,§3.9)。 */
  async activate(): Promise<void> {
    await this.ensureTarget()
    const port = await this.getPort()
    await globalThis.appHost.http.request({
      url: `http://127.0.0.1:${port}/json/activate/${this.targetId}`,
      method: "GET",
      responseType: "text",
      timeoutMs: 5_000,
    })
  }

  abortPending(reason: string): void {
    this.channel.abortPending(reason)
  }

  async close(): Promise<void> {
    await this.channel.closeWs()
    if (this.targetId) {
      const id = this.targetId
      this.targetId = null
      const port = await this.getPort().catch(() => null)
      if (port !== null) {
        await globalThis.appHost.http.request({
          url: `http://127.0.0.1:${port}/json/close/${id}`,
          method: "GET",
          responseType: "text",
          timeoutMs: 5_000,
        }).catch(() => {})
      }
    }
  }
}

export class TauriBrowserBackend implements BrowserBackend {
  private channel = new CdpChannel("default", { begin: () => this.begin(), end: () => this.end() })
  /** lane → tab 句柄(同 key 复用;LRU 上限 MAX_TABS)。 */
  private tabs = new Map<string, TauriBrowserTab>()
  /** 在途 CDP 命令数(空闲关闭只在 0 时执行)。 */
  private busy = 0
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  /** 本实例是否已扫过 Edge 自带界面的 target(重开浏览器后要重扫)。 */
  private junkSwept = false

  /** 记一次操作在途;归零后重新开始计时。 */
  private begin(): void {
    this.busy++
    this.touch()
  }

  private end(): void {
    this.busy = Math.max(0, this.busy - 1)
    this.touch()
  }

  /** 重置空闲计时(每次有操作就往后推)。 */
  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => void this.closeIfIdle(), IDLE_CLOSE_MS)
  }

  /** 空闲到点:还有在途命令就再等一轮(长登录/长轮询不能被打断)。 */
  private async closeIfIdle(): Promise<void> {
    this.idleTimer = null
    if (this.busy > 0) {
      this.touch()
      return
    }
    browserLog.idleClose({ minutes: IDLE_CLOSE_MS / 60_000 })
    await this.close().catch(() => {})
  }
  /** 记一次 invoke 并在 settle 后自清(失败不影响调用方)。host 级(browser_ensure)用。 */
  private track<T>(p: Promise<T>): Promise<T> {
    return this.channel.track(p)
  }

  /**
   * 拿 CDP 端口（幂等；tab/默认页共用）。
   *
   * ⚠️ 本分支（feat/webview2-browser）的浏览器 = Tauri 自己的 WebView2（端口 9334），
   * 不再 spawn 系统 Edge；CDP 客户端、target 选择、lane 逻辑全部不变。
   */
  private async port(): Promise<number> {
    return this.track(invoke<number>("webview_browser_open"))
  }

  /** 并发首连去重：两个 evaluate 同时触发时只能 spawn 一个 Edge。 */
  private connectingRef: Promise<void> | null = null

  /** 惰性建连(首次 evaluate 时)。返回的 ws 连到默认 page target 的 CDP 端点。 */
  private async ensureConn(): Promise<void> {
    if (!this.connectingRef) {
      this.connectingRef = this.channel
        .ensureConn(async () => {
          const port = await this.port()
          // 找第一个 page target 的 webSocketDebuggerUrl(/json/list 返回 page/background_page 等)。
          const res = await globalThis.appHost.http.request({
            url: `http://127.0.0.1:${port}/json/list`,
            method: "GET",
            responseType: "text",
            timeoutMs: 5_000,
          })
          const targets = JSON.parse(String(res.body)) as TargetInfo[]
          // ⚠️ 不能取「第一个 page」:实测 Edge 155 的 /json/list 首项是 `edge://nurturing/`,
          // 不是启动参数里的 about:blank —— 挂上去等于在 Edge 内置页上跑 Runtime.evaluate。
          // 顺序:启动参数那张 about:blank → 任一非 Edge 内置页 → 自己建一张。
          const page =
            targets.find((t) => t.type === "page" && t.url === "about:blank" && t.webSocketDebuggerUrl) ??
            targets.find((t) => t.type === "page" && !isEdgeUiTarget(t) && t.webSocketDebuggerUrl)
          if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
          const created = await globalThis.appHost.http.request({
            url: `http://127.0.0.1:${port}/json/new?about:blank`,
            method: "PUT",
            responseType: "text",
            timeoutMs: 5_000,
          })
          const fresh = JSON.parse(String(created.body)) as TargetInfo
          if (!fresh.webSocketDebuggerUrl) throw new Error("CDP: 未找到可附加的页面 target")
          return fresh.webSocketDebuggerUrl
        })
        .finally(() => {
          this.connectingRef = null
        })
    }
    await this.connectingRef
    await this.channel.armNetwork()
    await this.sweepEdgeUi()
  }

  /**
   * 关掉 Edge 自带界面的 target(`edge://nurturing`、Copilot 侧栏 iframe 等)。
   *
   * 实测一个 release 实例 12 个进程里，4 个 renderer 全是 Edge UI：合计约 127MB WS /
   * 204MB private，其中 Copilot iframe 自己 73MB JS heap，比抓取页面还大。这些既不
   * 走我们的 CDP 连接，也拦不住（armNetwork 只作用于本连接的 target），只能关。
   *
   * ⚠️ 不关 `browser_ui` 类型：那可能是窗口自身的 UI target，关掉有连带风险。
   * ⚠️ Edge 可能重开其中之一，扫一次就够（失败不重试，纯优化）。
   */
  private async sweepEdgeUi(): Promise<void> {
    if (this.junkSwept) return
    this.junkSwept = true
    try {
      const port = await this.port()
      const list = await globalThis.appHost.http.request({
        url: `http://127.0.0.1:${port}/json/list`,
        method: "GET",
        responseType: "text",
        timeoutMs: 5_000,
      })
      const targets = JSON.parse(String(list.body)) as TargetInfo[]
      const junk = targets.filter((t) => t.id && t.type !== "browser_ui" && isEdgeUiTarget(t))
      for (const t of junk) {
        await globalThis.appHost.http
          .request({
            url: `http://127.0.0.1:${port}/json/close/${t.id}`,
            method: "GET",
            responseType: "text",
            timeoutMs: 3_000,
          })
          .catch(() => {})
      }
      if (junk.length > 0) browserLog.uiSweep({ count: junk.length })
    } catch {
      // 列不出来就算了：这只是省内存，不影响抓取。
    }
  }

  tab(key: string): BrowserTab {
    // LRU:重挂到 map 尾部(Map 迭代按插入序,最旧在首)。
    const existing = this.tabs.get(key)
    if (existing) {
      this.tabs.delete(key)
      this.tabs.set(key, existing)
      return existing
    }
    // 超限:关最久未用的 lane(首个)。其句柄还在别的引用里也安全——close 后再 evaluate 会重建。
    while (this.tabs.size >= MAX_TABS) {
      const oldest = this.tabs.keys().next().value
      if (oldest === undefined) break
      const t = this.tabs.get(oldest)
      this.tabs.delete(oldest)
      void t?.close().catch(() => {})
    }
    const t = new TauriBrowserTab(key, () => this.port(), { begin: () => this.begin(), end: () => this.end() })
    this.tabs.set(key, t)
    return t
  }

  abortTabs(reason: string, opts?: { keepLogin?: boolean }): void {
    for (const [key, t] of this.tabs) {
      if (opts?.keepLogin && key.startsWith("login:")) continue
      t.abortPending(reason)
    }
  }

  /** 发一条 CDP 命令（公开入口；惰性建连）。 */
  async send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<unknown> {
    await this.ensureConn()
    return this.channel.send(method, params, sessionId)
  }

  /** 订阅 CDP 事件（无 id 的帧），返回取消订阅函数。 */
  onEvent(cb: CdpEventListener): () => void {
    return this.channel.onEvent(cb)
  }

  /**
   * 切换窗口模式（hidden = SW_HIDE，interactive = 屏外 shown + 渲染）。
   * ⚠️ Rust 侧 `browser_ensure` 不带 mode 时只确保就绪、**不改模式**，
   * 所以这里切完不会被后续 `ensureConn` 打回 hidden。
   */
  async setMode(mode: BrowserWindowMode): Promise<void> {
    // WebView2 用窗口 show/hide 表达：interactive = 屏外显示，hidden = 藏窗口。
    await this.track(invoke("webview_browser_set_mode", { mode }))
  }

  async evaluate<T = unknown>(
    expression: string,
    opts?: { awaitPromise?: boolean; returnByValue?: boolean },
  ): Promise<T> {
    await this.ensureConn()
    const r = (await this.channel.send("Runtime.evaluate", {
      expression,
      awaitPromise: opts?.awaitPromise ?? true,
      returnByValue: opts?.returnByValue ?? true,
    })) as { exceptionDetails?: unknown; result?: { value?: unknown } }
    if (r.exceptionDetails) {
      const d = (r.exceptionDetails as { text?: string; exception?: { description?: string } }).exception
      const detail = d?.description ?? JSON.stringify(r.exceptionDetails)
      // 走 host:browser 日志域(表达式可能含中文/长签名,完整打印便于定位语法错误来源)。
      browserLog.evalError({ expression, detail })
      throw new Error(`CDP evaluate 异常: ${detail}`)
    }
    return r.result?.value as T
  }

  /** 读 cookie(含 HttpOnly)。传 url 只取该域(Network.getCookies urls),否则取全部。
   *  ⚠️ document.cookie 读不到 HttpOnly(web_session 是 HttpOnly),登录态检测/取 cookie 必须走这里。 */
  async getCookies(url?: string): Promise<Record<string, string>> {
    await this.ensureConn()
    const r = (url
      ? await this.channel.send("Network.getCookies", { urls: [url] })
      : await this.channel.send("Network.getAllCookies", {})
    ) as { cookies?: Array<{ name: string; value: string }> }
    const out: Record<string, string> = {}
    for (const c of r.cookies ?? []) out[c.name] = c.value
    return out
  }

  /**
   * 清除匹配域名后缀的 cookie(含 HttpOnly)。
   *
   * 「清除凭证」如果只清 settings,桌面抓取仍走 Edge profile 的登录态 —— 用户以为
   * 退出了,实际还在用同一个真实账号访问小红书。这里按域名精确删除,避免连带把
   * 微博/抖音等其他平台的登录态一起清掉(那是「清理浏览器数据」的职责)。
   *
   * ⚠️ 浏览器没启动时会 `ensureConn()` 拉起一次(否则下次抓取照样带着 cookie),
   * 用完保持运行,不额外 close。
   */
  async clearCookies(domainSuffix: string): Promise<number> {
    await this.ensureConn()
    const suffix = domainSuffix.replace(/^\./, "")
    const r = (await this.channel.send("Network.getAllCookies", {})) as {
      cookies?: Array<{ name: string; domain?: string; path?: string }>
    }
    // 只认「自身或子域」:`notxiaohongshu.com`.endsWith(`xiaohongshu.com`) 也是 true,
    // 裸 endsWith 会误删第三方站点。域名按标签边界匹配。
    const host = suffix.toLowerCase()
    const targets = (r.cookies ?? []).filter((c) => {
      const d = (c.domain ?? "").replace(/^\./, "").toLowerCase()
      return d === host || d.endsWith(`.${host}`)
    })
    for (const c of targets) {
      await this.channel.send("Network.deleteCookies", {
        name: c.name,
        domain: c.domain,
        path: c.path ?? "/",
      })
    }
    return targets.length
  }

  async close(): Promise<void> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    await this.channel.closeWs()
    for (const [, t] of this.tabs) await t.close().catch(() => {})
    this.tabs.clear()
    this.junkSwept = false // 下次连的是新实例，要重扫
    await this.track(invoke("webview_browser_close")).catch(() => {})
  }

  /** 清空抓取 profile（Rust 侧关 webview + 删目录）。 */
  async resetProfile(): Promise<string> {
    // 连接已随进程销毁失效,清掉本地引用,下次 evaluate 会重新 ensureConn。
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    await this.channel.closeWs()
    for (const [, t] of this.tabs) t.abortPending("浏览器 profile 已重置")
    this.tabs.clear()
    this.junkSwept = false
    return await invoke<string>("webview_browser_reset")
  }
}
