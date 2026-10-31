/**
 * CDP BrowserBackend 通用实现 —— 载具无关的 lane/tab/事件/超时/空闲回收。
 *
 * 桌面与 CLI 的唯一差异收敛在 BrowserDriver：
 *   - 谁拉起浏览器（WebView2 走 Tauri invoke；CLI 走 spawn 系统 Chromium）；
 *   - target 怎么建（WebView2 每个 target = 独立顶层窗口，要给屏外坐标并 tidy；
 *     Chrome 是普通 tab）；
 *   - 哪些 target 是垃圾（Edge 自带界面）、要不要空闲回收。
 * 其余（evaluate / cookie / lane 隔离 / 30s 超时 / 资源拦截）全部在这里，只有一份。
 *
 * ⚠️ 行为契约（改这里前先读）：
 *   - 每条 CDP 命令都有硬超时：页面导航后旧 id 的回复会永久丢失（channel.ts）。
 *   - lane = 独立 target + 独立 CdpChannel（独立 pending/事件帧），cookie 浏览器级共享。
 *   - 默认通道不能取「第一个 page」：WebView2 实测首项是 `edge://nurturing/`。
 *   - `Target.createTarget` 的默认页兜底必须走它而不是 `/json/new`：后者在 WebView2 下
 *     会建一个未整理的可见顶层窗口。
 */

import { browserLog } from "../log.ts"
import { CdpChannel } from "./channel.ts"
import type { CdpConnector } from "./transport.ts"

/** `/json/list` 的条目(只取用得到的字段)。 */
export interface CdpTargetInfo {
  id?: string
  type?: string
  url?: string
  webSocketDebuggerUrl?: string
}

/**
 * 资源拦截：字体/媒体/统计域名对抓取零价值(页面内容走 SSR HTML + 签名脚本 + cookie)。
 * **不拦 CSS** —— 布局一变，懒加载与可见性判定(IntersectionObserver)可能跟着变。
 * 图片在启动参数层关掉(WebView2 用 `--blink-settings=imagesEnabled=false`)。
 */
export const BLOCKED_URL_PATTERNS = [
  "*.woff",
  "*.woff2",
  "*.ttf",
  "*.otf",
  "*.mp4",
  "*.m3u8",
  "*.ts",
  "*.m4s",
  "*.webm",
  "*.flv",
  "*.mov",
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

/** lane tab 的 LRU 上限(每 tab ≈60–120MB,不设上限内存不可控)。 */
export const MAX_TABS = 8

/**
 * 载具驱动 —— 桌面 WebView2 与 CLI Chromium 的唯一差异面。
 * 只放「怎么拉起/整理进程与窗口」，不放 CDP 语义。
 */
export interface BrowserDriver {
  /** 幂等；返回 CDP 端口。首次调用拉起浏览器。 */
  ensureReady(): Promise<number>
  /**
   * `/json/list` 里哪些 target 可用。默认全可用。
   * 返回 false 的 target 会被默认通道跳过、并在首次连接时关掉（Edge 自带界面）。
   */
  isUsableTarget?(t: CdpTargetInfo): boolean
  /** `Target.createTarget` 的参数（WebView2 要给 newWindow + 屏外坐标）。 */
  targetParams?(): Record<string, unknown>
  /** 建/激活 target 之后的窗口整理（WebView2 的 tidy；无窗口载具不实现）。 */
  afterTargetChange?(): Promise<void>
  /** 切换窗口模式；无窗口载具不实现（= 空操作）。 */
  setMode?(mode: BrowserWindowMode): Promise<void>
  /** 关闭浏览器进程（应用退出 / 空闲回收）。 */
  close(): Promise<void>
  /** 清空 profile；不实现 = 当前载具不支持。 */
  resetProfile?(): Promise<string>
  /** 空闲回收毫秒数；不设 = 不回收（CLI 一次性进程不需要）。 */
  idleCloseMs?: number
  /**
   * **单个 lane tab** 的空闲回收毫秒数；不设 = 不回收。
   *
   * 与 `idleCloseMs`（整个浏览器）互补：别的 lane 持续在用时浏览器整体不会空闲，
   * 抖音/小红书这类重页面就会一直常驻（实测单 tab 150–440MB）。到点后关 target、
   * 保留句柄 —— 下次 evaluate 走既有的「target 丢失自愈」重建（渠道本就要处理
   * 「页面被导航走」：`href` 对不上就重新导航收首屏，douyin/xhs 均如此）。
   */
  tabIdleCloseMs?: number
  /** 在通用拦截表之外追加的 URL 模式。 */
  extraBlockedUrls?: string[]
}

export interface CdpBackendOptions {
  driver: BrowserDriver
  connector: CdpConnector
}

/** tab 需要的宿主能力（HTTP 细节留在 backend，避免两处拼 URL）。 */
interface TabDeps {
  getPort(): Promise<number>
  createTarget(port: number): Promise<string>
  listTargets(port: number): Promise<CdpTargetInfo[]>
  closeTarget(port: number, id: string): Promise<void>
  activateTarget(port: number, id: string): Promise<void>
  afterTargetChange(): Promise<void>
  connector: CdpConnector
  activity: { begin(): void; end(): void }
  blockedUrls: string[]
  /** lane tab 空闲回收（0 = 不回收）。 */
  tabIdleCloseMs: number
  onTabIdleClosed(key: string): void
}

/** Runtime.evaluate + 异常归一 —— 默认 page 与每个 lane tab 共用，错误文案只此一份。 */
async function evaluateOn<T>(
  channel: CdpChannel,
  expression: string,
  opts?: { awaitPromise?: boolean; returnByValue?: boolean },
): Promise<T> {
  const r = (await channel.send("Runtime.evaluate", {
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

/** 读 cookie（含 HttpOnly）。传 url 只取该域，否则取全部。 */
async function cookiesOn(channel: CdpChannel, url?: string): Promise<Record<string, string>> {
  const r = (
    url ? await channel.send("Network.getCookies", { urls: [url] }) : await channel.send("Network.getAllCookies", {})
  ) as { cookies?: Array<{ name: string; value: string }> }
  const out: Record<string, string> = {}
  for (const c of r.cookies ?? []) out[c.name] = c.value
  return out
}

/** lane tab 句柄:独立 target + 独立 CdpChannel。 */
class CdpBrowserTab implements BrowserTab {
  private channel: CdpChannel
  private targetId: string | null = null
  private ensuring: Promise<void> | null = null
  /** 最近一次拿到的端口：close() 用它关 target，绝不重新 open（关闭路径反而拉起浏览器）。 */
  private lastPort: number | null = null
  /** 本 tab 在途 CDP 命令数（tab 空闲回收只在 0 时执行）。 */
  private tabBusy = 0
  private tabIdleTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    readonly key: string,
    private readonly deps: TabDeps,
  ) {
    // activity 双计：全局计数（整机空闲回收）+ 本 tab 计数（tab 空闲回收）。
    const outer = deps.activity
    this.channel = new CdpChannel(`tab:${key}`, deps.connector, {
      begin: () => {
        this.tabBusy++
        outer.begin()
      },
      end: () => {
        this.tabBusy = Math.max(0, this.tabBusy - 1)
        this.touchTabIdle()
        outer.end()
      },
    })
  }

  /**
   * 确保 target 存在（一次）。
   *
   * ⚠️ WebView2 没有 tab：每个 target 都是**独立顶层窗口**（`/json/new` 也会开新窗口），
   * 所以 targetParams 由载具给（WebView2 = 屏外坐标 + background），创建后立刻整理。
   */
  private ensureTarget(): Promise<void> {
    if (this.targetId) return Promise.resolve()
    if (!this.ensuring) {
      this.ensuring = (async () => {
        const port = await this.deps.getPort()
        this.lastPort = port
        this.targetId = await this.deps.createTarget(port)
      })().finally(() => {
        this.ensuring = null
      })
    }
    return this.ensuring
  }

  /** 本 tab 的 ws 端点(target 的 webSocketDebuggerUrl)。target 丢失时自愈重建一次。 */
  private async openWs(): Promise<string> {
    await this.ensureTarget()
    const port = await this.deps.getPort()
    this.lastPort = port
    // /json/list 里按 id 找本 target(拿最新 webSocketDebuggerUrl;重连安全)。
    const list = () => this.deps.listTargets(port)
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
    await this.channel.armNetwork(this.deps.blockedUrls)
  }

  async evaluate<T = unknown>(
    expression: string,
    opts?: { awaitPromise?: boolean; returnByValue?: boolean },
  ): Promise<T> {
    await this.ensureConn()
    return evaluateOn<T>(this.channel, expression, opts)
  }

  async getCookies(url?: string): Promise<Record<string, string>> {
    await this.ensureConn()
    return cookiesOn(this.channel, url)
  }

  async send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<unknown> {
    // ⚠️ 必须惰性建连(与 backend.send 对齐):capturePage 的第一条命令就是
    // send("Network.enable"),而 withBrowserOp 的 hidden 分支不会先 evaluate ——
    // 缺这一行时新建的 lane tab 首条命令直接 "CDP not connected",被动渠道每次刷新
    // 都回退缓存报错(审查发现,2026-10-22)。
    await this.ensureConn()
    return this.channel.send(method, params, sessionId)
  }

  onEvent(cb: (method: string, params: unknown, sessionId?: string) => void): () => void {
    return this.channel.onEvent(cb)
  }

  /** 激活本 tab(毫秒级、不重载)——滚动驱动前必须(非激活 tab rAF/IO 停摆,§3.9)。 */
  async activate(): Promise<void> {
    await this.ensureTarget()
    const port = await this.deps.getPort()
    await this.deps.activateTarget(port, this.targetId as string)
    // activate 可能把窗口带到前台/恢复显示：重新按 interactive 模式摆回屏外。
    await this.deps.afterTargetChange()
  }

  /** tab 空闲计时：每次有命令就重排；没有 target（从未打开/已回收）不挂计时。 */
  private touchTabIdle(): void {
    const ms = this.deps.tabIdleCloseMs
    if (!ms) return
    if (this.tabIdleTimer) clearTimeout(this.tabIdleTimer)
    if (!this.targetId) return
    this.tabIdleTimer = setTimeout(() => void this.closeTabIfIdle(), ms)
  }

  /** tab 空闲到点：还有在途命令就再等一轮（长滚动/长轮询不能被打断）。 */
  private async closeTabIfIdle(): Promise<void> {
    this.tabIdleTimer = null
    if (this.tabBusy > 0 || !this.targetId) {
      this.touchTabIdle()
      return
    }
    this.deps.onTabIdleClosed(this.key)
    await this.close().catch(() => {})
  }

  abortPending(reason: string): void {
    this.channel.abortPending(reason)
  }

  async close(): Promise<void> {
    if (this.tabIdleTimer) {
      clearTimeout(this.tabIdleTimer)
      this.tabIdleTimer = null
    }
    await this.channel.closeWs()
    if (this.targetId) {
      const id = this.targetId
      this.targetId = null
      // ⚠️ 用缓存端口，不调 getPort()（= 拉起浏览器）：关闭路径不能反过来
      // 创建/重建浏览器。浏览器已不在时 /json/close 失败即可。
      const port = this.lastPort
      this.lastPort = null
      if (port !== null) await this.deps.closeTarget(port, id)
    }
  }
}

export class CdpBrowserBackend implements BrowserBackend {
  private readonly driver: BrowserDriver
  private readonly connector: CdpConnector
  private readonly channel: CdpChannel
  private readonly blockedUrls: string[]
  /** lane → tab 句柄(同 key 复用;LRU 上限 MAX_TABS)。 */
  private tabs = new Map<string, CdpBrowserTab>()
  /** 在途 CDP 命令数(空闲关闭只在 0 时执行)。 */
  private busy = 0
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  /** 本实例是否已扫过垃圾 target(重开浏览器后要重扫)。 */
  private junkSwept = false
  /** 浏览器级 CDP 连接（`Target.createTarget` 用；HTTP `/json/new` 不能给窗口坐标）。 */
  private browserChannel: CdpChannel | null = null
  private browserConnecting: Promise<CdpChannel> | null = null
  /** 并发首连去重：两个 evaluate 同时触发时只能建一个 webview。 */
  private connectingRef: Promise<void> | null = null

  constructor(opts: CdpBackendOptions) {
    this.driver = opts.driver
    this.connector = opts.connector
    this.blockedUrls = [...BLOCKED_URL_PATTERNS, ...(opts.driver.extraBlockedUrls ?? [])]
    this.channel = new CdpChannel("default", this.connector, {
      begin: () => this.begin(),
      end: () => this.end(),
    })
  }

  /** 记一次操作在途;归零后重新开始计时。 */
  private begin(): void {
    this.busy++
    this.touch()
  }

  private end(): void {
    this.busy = Math.max(0, this.busy - 1)
    this.touch()
  }

  /** 重置空闲计时(每次有操作就往后推)。无 idleCloseMs 的载具不回收。 */
  private touch(): void {
    const ms = this.driver.idleCloseMs
    if (!ms) return
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => void this.closeIfIdle(), ms)
  }

  /** 空闲到点:还有在途命令就再等一轮(长登录/长轮询不能被打断)。 */
  private async closeIfIdle(): Promise<void> {
    this.idleTimer = null
    if (this.busy > 0) {
      this.touch()
      return
    }
    browserLog.idleClose({ minutes: Number(((this.driver.idleCloseMs ?? 0) / 60_000).toFixed(1)) })
    await this.close().catch(() => {})
  }

  /** 拿 CDP 端口（幂等；tab/默认页共用）。 */
  private port(): Promise<number> {
    return this.driver.ensureReady()
  }

  private async getJson<T>(url: string, timeoutMs: number): Promise<T> {
    const res = await globalThis.appHost.http.request({
      url,
      method: "GET",
      responseType: "text",
      timeoutMs,
    })
    return JSON.parse(String(res.body)) as T
  }

  private listTargets(port: number): Promise<CdpTargetInfo[]> {
    return this.getJson<CdpTargetInfo[]>(`http://127.0.0.1:${port}/json/list`, 5_000)
  }

  private async closeTarget(port: number, id: string): Promise<void> {
    await globalThis.appHost.http
      .request({
        url: `http://127.0.0.1:${port}/json/close/${id}`,
        method: "GET",
        responseType: "text",
        timeoutMs: 3_000,
      })
      .catch(() => {})
  }

  private async activateTarget(port: number, id: string): Promise<void> {
    await globalThis.appHost.http.request({
      url: `http://127.0.0.1:${port}/json/activate/${id}`,
      method: "GET",
      responseType: "text",
      timeoutMs: 5_000,
    })
  }

  private isUsable(t: CdpTargetInfo): boolean {
    return this.driver.isUsableTarget?.(t) ?? true
  }

  /** 建/激活 target 后的窗口整理；载具没实现就跳过（整理只是优化，失败不致命）。 */
  private async afterTargetChange(): Promise<void> {
    try {
      await this.driver.afterTargetChange?.()
    } catch {
      /* 窗口整理失败不影响抓取 */
    }
  }

  /** 浏览器级 CDP 连接（`/json/version` 的 webSocketDebuggerUrl）。 */
  private async browserCmd(port?: number): Promise<CdpChannel> {
    if (this.browserChannel) return this.browserChannel
    if (!this.browserConnecting) {
      this.browserConnecting = (async () => {
        const p = port ?? (await this.port())
        const v = await this.getJson<{ webSocketDebuggerUrl?: string }>(`http://127.0.0.1:${p}/json/version`, 5_000)
        const url = v.webSocketDebuggerUrl
        if (!url) throw new Error("CDP: /json/version 未返回浏览器端点")
        const channel = new CdpChannel("browser", this.connector, {
          begin: () => this.begin(),
          end: () => this.end(),
        })
        await channel.ensureConn(async () => url)
        this.browserChannel = channel
        return channel
      })().finally(() => {
        this.browserConnecting = null
      })
    }
    return this.browserConnecting
  }

  /**
   * 建一个 lane target。
   *
   * ⚠️ WebView2 没有 tab：`Target.createTarget` 每个 target 都是独立顶层窗口。
   * 必须由载具给屏外坐标 + `background`（否则会在屏幕/任务栏闪一下），创建后立刻整理。
   */
  private async createTarget(port: number): Promise<string> {
    let last: unknown
    let current = port
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const channel = await this.browserCmd(current)
        const r = (await channel.send(
          "Target.createTarget",
          this.driver.targetParams?.() ?? { url: "about:blank", background: true },
        )) as { targetId?: string }
        if (!r.targetId) throw new Error("CDP: Target.createTarget 未返回 targetId")
        await this.afterTargetChange()
        return r.targetId
      } catch (e) {
        last = e
        // 浏览器可能刚被空闲回收/崩溃：丢掉旧连接，并**重新 open** 后再试。
        // ⚠️ 不能沿用入参端口：browserCmd(port) 只 GET /json/version，不会重建浏览器。
        await this.browserChannel?.closeWs().catch(() => {})
        this.browserChannel = null
        current = await this.port().catch(() => current)
      }
    }
    throw last instanceof Error ? last : new Error(String(last))
  }

  /** 惰性建连(首次 evaluate 时)。返回的 ws 连到默认 page target 的 CDP 端点。 */
  private async ensureConn(): Promise<void> {
    if (!this.connectingRef) {
      this.connectingRef = this.channel
        .ensureConn(async () => {
          const port = await this.port()
          const targets = await this.listTargets(port)
          // ⚠️ 不能取「第一个 page」:实测 Edge 155 的 /json/list 首项是 `edge://nurturing/`,
          // 不是启动参数里的 about:blank —— 挂上去等于在 Edge 内置页上跑 Runtime.evaluate。
          // 顺序:启动参数那张 about:blank → 任一非垃圾 page → 自己建一张。
          const page =
            targets.find(
              (t) => t.type === "page" && t.url === "about:blank" && t.webSocketDebuggerUrl && this.isUsable(t),
            ) ?? targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl && this.isUsable(t))
          if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
          // 兜底也要走 createTarget：`/json/new` 会建一个未整理的可见顶层窗口。
          const id = await this.createTarget(port)
          const after = await this.listTargets(port)
          const fresh = after.find((t) => t.id === id)
          if (!fresh?.webSocketDebuggerUrl) throw new Error("CDP: 未找到可附加的页面 target")
          return fresh.webSocketDebuggerUrl
        })
        .finally(() => {
          this.connectingRef = null
        })
    }
    await this.connectingRef
    await this.channel.armNetwork(this.blockedUrls)
    await this.sweepJunk(await this.port())
  }

  /**
   * 关掉载具判定为「垃圾」的 target（WebView2 的 `edge://nurturing`、Copilot 侧栏等）。
   *
   * 实测这些既不 走我们的 CDP 连接，也拦不住（armNetwork 只作用于本连接的 target），
   * 只能关。WebView2 可能重开其中之一，扫一次就够（失败不重试，纯优化）。
   */
  private async sweepJunk(port: number): Promise<void> {
    if (this.junkSwept) return
    this.junkSwept = true
    try {
      const targets = await this.listTargets(port)
      const junk = targets.filter((t) => t.id && !this.isUsable(t))
      for (const t of junk) await this.closeTarget(port, t.id as string)
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
    const tab = new CdpBrowserTab(key, {
      getPort: () => this.port(),
      createTarget: (port) => this.createTarget(port),
      listTargets: (port) => this.listTargets(port),
      closeTarget: (port, id) => this.closeTarget(port, id),
      activateTarget: (port, id) => this.activateTarget(port, id),
      afterTargetChange: () => this.afterTargetChange(),
      connector: this.connector,
      activity: { begin: () => this.begin(), end: () => this.end() },
      blockedUrls: this.blockedUrls,
      tabIdleCloseMs: this.driver.tabIdleCloseMs ?? 0,
      onTabIdleClosed: (k) =>
        browserLog.tabIdleClose({ key: k, minutes: Number(((this.driver.tabIdleCloseMs ?? 0) / 60_000).toFixed(1)) }),
    })
    this.tabs.set(key, tab)
    return tab
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
  onEvent(cb: (method: string, params: unknown, sessionId?: string) => void): () => void {
    return this.channel.onEvent(cb)
  }

  /**
   * 切换窗口模式（hidden = 隐藏，interactive = 屏外显示 + 正常渲染）。
   * 无窗口载具（headless）不实现 setMode —— 页面本来就一直渲染。
   */
  async setMode(mode: BrowserWindowMode): Promise<void> {
    await this.driver.setMode?.(mode)
  }

  async evaluate<T = unknown>(
    expression: string,
    opts?: { awaitPromise?: boolean; returnByValue?: boolean },
  ): Promise<T> {
    await this.ensureConn()
    return evaluateOn<T>(this.channel, expression, opts)
  }

  /** 读 cookie(含 HttpOnly)。传 url 只取该域(Network.getCookies urls),否则取全部。
   *  ⚠️ document.cookie 读不到 HttpOnly(web_session 是 HttpOnly),登录态检测/取 cookie 必须走这里。 */
  async getCookies(url?: string): Promise<Record<string, string>> {
    await this.ensureConn()
    return cookiesOn(this.channel, url)
  }

  /**
   * 清除匹配域名后缀的 cookie(含 HttpOnly)。
   *
   * 「清除凭证」如果只清 settings,桌面抓取仍走 profile 的登录态 —— 用户以为
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
    await this.browserChannel?.closeWs().catch(() => {})
    this.browserChannel = null
    for (const [, t] of this.tabs) await t.close().catch(() => {})
    this.tabs.clear()
    this.junkSwept = false // 下次连的是新实例，要重扫
    await this.driver.close().catch(() => {})
  }

  /** 清空浏览器 profile（载具实现：先关浏览器再删目录）。 */
  async resetProfile(): Promise<string> {
    if (!this.driver.resetProfile) throw new Error("当前浏览器载具不支持清空 profile")
    // 连接已随进程销毁失效,清掉本地引用,下次 evaluate 会重新 ensureConn。
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    await this.channel.closeWs()
    await this.browserChannel?.closeWs().catch(() => {})
    this.browserChannel = null
    for (const [, t] of this.tabs) t.abortPending("浏览器 profile 已重置")
    this.tabs.clear()
    this.junkSwept = false
    return await this.driver.resetProfile()
  }
}
