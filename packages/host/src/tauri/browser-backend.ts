/**
 * TauriBrowserBackend — BrowserBackend 实现,CDP 附加真实 Edge(生产浏览器模拟)。
 *
 * 微博/小红书反爬强,需真实浏览器提供登录态 + JS 签名(_webmsxyw)+ 设备指纹。
 * Rust `browser_ensure` spawn 系统 Edge(--remote-debugging-port + user-data-dir
 * 持久化登录态),本后端:
 *   1. invoke browser_ensure → 拿 CDP 端口;
 *   2. GET /json/list → 找第一个 page target 的 webSocketDebuggerUrl;
 *   3. invoke ws_connect(文本帧)——CDP 是 JSON 文本帧,不走弹幕二进制隧道,
 *      自己管理 connectionId + 消息 id 递增的 pending map;
 *   4. evaluate = Runtime.evaluate(awaitPromise + returnByValue)。
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
 * 只在「回复永久丢失」时才触发——见 send() 里的注释。
 */
const CDP_CMD_TIMEOUT_MS = 30_000

export class TauriBrowserBackend implements BrowserBackend {
  private connId: string | null = null
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private nextId = 1
  /**
   * 当前在途的 invoke promise(ensureConn / send / getCookies 都记在这里)。
   *
   * ⚠️ 这是「取消」的唯一抓手:Rust 侧的 invoke **没有超时**,一次不回话就永久挂起;
   * 而抓取层是在 withBrowserLock 里 await 它。调用方(desktop refreshAll)对整条
   * 刷新套了 45s 超时,但超时只 reject 了**外层** promise —— 这条被挂住的 invoke
   * 仍持有浏览器锁,后续所有浏览器操作排队到天荒地老。
   * abortPending() 至少让持锁的那个 await 立刻以错误返回,锁得以释放。
   */
  private inflight = new Set<Promise<unknown>>()

  /** 记一次 invoke 并在 settle 后自清(失败不影响调用方)。 */
  private track<T>(p: Promise<T>): Promise<T> {
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
      void this.track(invoke("ws_close", { connectionId: id })).catch(() => {})
    }
  }

  /** 惰性建连(首次 evaluate 时)。返回的 ws 连到 page target 的 CDP 端点。 */
  private async ensureConn(): Promise<void> {
    if (this.connId) return

    const port = await this.track(invoke<number>("browser_ensure"))
    // 找第一个 page target 的 webSocketDebuggerUrl(/json/list 返回 page/background_page 等)。
    const res = await globalThis.appHost.http.request({
      url: `http://127.0.0.1:${port}/json/list`,
      method: "GET",
      responseType: "text",
      timeoutMs: 5_000,
    })
    const targets = JSON.parse(String(res.body)) as Array<{ type?: string; webSocketDebuggerUrl?: string }>
    const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl)
    if (!page?.webSocketDebuggerUrl) throw new Error("CDP: 未找到可附加的页面 target")

    const onEvent = new Channel<CdpEventMsg>()
    onEvent.onmessage = (ev) => this.handleEvent(ev)

    const c = await this.track(
      invoke<{ connectionId: string }>("ws_connect", {
        req: { url: page.webSocketDebuggerUrl, headers: {}, timeoutMs: 10_000 },
        onEvent,
      }),
    )
    this.connId = c.connectionId
  }

  /** 发一条 CDP 命令(文本帧),等匹配 id 的响应。 */
  private send(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.connId) return Promise.reject(new Error("CDP not connected"))
    const id = this.nextId++
    const msg = JSON.stringify({ id, method, params })
    const payload = toBase64(msg)
    return new Promise((resolve, reject) => {
      // ⚠️ 单条命令超时是必须的:页面在命令未回话时被导航/替换,该 id 的回复会
      // **永久丢失**,promise 就此永不 settle。后果不是「这一条卡住」而是全线卡死:
      // waitUntil 的 deadline 只在两次 evaluate 之间检查,单次 evaluate 挂住就轮不到
      // 超时判断(它的 timeoutMs 形同虚设)→ withBrowserLock 永不释放 → 整轮
      // refreshAll 不结束(顶栏「更新中」永久转圈)。超时把「无限等待」降级成
      // 「这条命令报错」,waitUntil 得以走到自己的 deadline。
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`CDP 命令超时(${method}):页面可能已导航,回复丢失`))
      }, CDP_CMD_TIMEOUT_MS)
      const settle = <T>(fn: (v: T) => void) => (v: T) => {
        clearTimeout(timer)
        fn(v)
      }
      this.pending.set(id, { resolve: settle(resolve), reject: settle(reject) })
      void this.track(invoke("ws_send", { connectionId: this.connId, payload, text: true })).catch((e) => {
        if (!this.pending.delete(id)) return
        clearTimeout(timer)
        reject(e instanceof Error ? e : new Error(String(e)))
      })
    })
  }

  private handleEvent(ev: CdpEventMsg): void {
    if (ev.event !== "Text") return
    const msg = JSON.parse(fromBase64(ev.data as string)) as { id?: number; error?: unknown; result?: unknown }
    if (msg.id === undefined) return // 事件帧(无 id),忽略
    const p = this.pending.get(msg.id)
    if (!p) return
    this.pending.delete(msg.id)
    if (msg.error) p.reject(new Error(`CDP ${JSON.stringify(msg.error)}`))
    else p.resolve(msg.result)
  }

  async evaluate<T = unknown>(
    expression: string,
    opts?: { awaitPromise?: boolean; returnByValue?: boolean },
  ): Promise<T> {
    await this.ensureConn()
    const r = (await this.send("Runtime.evaluate", {
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
      ? await this.send("Network.getCookies", { urls: [url] })
      : await this.send("Network.getAllCookies", {})
    ) as { cookies?: Array<{ name: string; value: string }> }
    const out: Record<string, string> = {}
    for (const c of r.cookies ?? []) out[c.name] = c.value
    return out
  }

  async close(): Promise<void> {
    if (this.connId) {
      await this.track(invoke("ws_close", { connectionId: this.connId })).catch(() => {})
      this.connId = null
    }
    await this.track(invoke("browser_close")).catch(() => {})
  }

  /** 清空 profile(Rust 侧 browser_reset_profile:杀我们的 Edge 树 + 删目录)。 */
  async resetProfile(): Promise<string> {
    // 连接已随进程销毁失效,清掉本地引用,下次 evaluate 会重新 ensureConn。
    this.connId = null
    return await invoke<string>("browser_reset_profile")
  }
}
