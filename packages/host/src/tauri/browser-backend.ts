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

export class TauriBrowserBackend implements BrowserBackend {
  private connId: string | null = null
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private nextId = 1

  /** 惰性建连(首次 evaluate 时)。返回的 ws 连到 page target 的 CDP 端点。 */
  private async ensureConn(): Promise<void> {
    if (this.connId) return

    const port = await invoke<number>("browser_ensure")
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

    const c = await invoke<{ connectionId: string }>("ws_connect", {
      req: { url: page.webSocketDebuggerUrl, headers: {}, timeoutMs: 10_000 },
      onEvent,
    })
    this.connId = c.connectionId
  }

  /** 发一条 CDP 命令(文本帧),等匹配 id 的响应。 */
  private send(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.connId) return Promise.reject(new Error("CDP not connected"))
    const id = this.nextId++
    const msg = JSON.stringify({ id, method, params })
    const payload = toBase64(msg)
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      void invoke("ws_send", { connectionId: this.connId, payload, text: true }).catch((e) => {
        this.pending.delete(id)
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
      await invoke("ws_close", { connectionId: this.connId }).catch(() => {})
      this.connId = null
    }
    await invoke("browser_close").catch(() => {})
  }
}
