/**
 * browser-sim —— 验证脚本:CDP 隧道 + 浏览器模拟抓取(weibo:user / xhs:user)。
 *
 * 生产路径:appHost.browser = Tauri spawn 系统 Edge + CDP(packages/host tauri/
 * browser-backend.ts)。本脚本用**同一个 edge-cdp skill** 在 WSL 侧拉起干净的
 * Windows Edge,再以 bun 内置 WebSocket 直连 CDP,模拟同形状的 BrowserBackend,
 * 验证 crawler 侧 cdp.ts + channel 浏览器路径。
 *
 * 用法(先起干净 Edge,再跑本脚本):
 *   bash <edge-cdp skill>/scripts/launch_clean_edge.sh      # 默认端口 9322
 *   bun run packages/crawler/src/example/browser-sim.ts weibo:user
 *   bun run packages/crawler/src/example/browser-sim.ts xhs:user
 *
 * 端口取 EDGE_CDP_PORT(与启动脚本同名变量),默认 9322。
 * ⚠️ xhs:user / weibo:user 需登录态——干净 profile 是匿名的,登录态走
 *    launch_clean_edge.sh --keep(复用已有 profile)。反复验证会触发账号风控,低频单次。
 */
import { injectNodeHost, setHostCaps, nodeBackend, nodeJsBackend, memStorage } from "@tauri-playground/host"

const PORT = Number(process.env.EDGE_CDP_PORT ?? 9322)

/**
 * CDP 页面连接 —— TauriBrowserBackend(packages/host/src/tauri/browser-backend.ts)的
 * bun 对等物,形状对齐 global.d.ts 的 BrowserBackend。
 *
 * 走 bun 内置 WebSocket(浏览器原生 API,自带帧封装),不再需要 playwright-core。
 * CDP 帧带数字 id,用 pending map 配对响应;无 id 的帧是事件,忽略。
 */
class CdpPage implements BrowserBackend {
  private ws: WebSocket
  private nextId = 1
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  private ready: Promise<void>

  private constructor(wsUrl: string) {
    this.ws = new WebSocket(wsUrl)
    this.ws.onmessage = (ev: MessageEvent) => this.handle(String(ev.data))
    this.ws.onerror = () => this.failAll(new Error("CDP WebSocket 错误"))
    this.ready = new Promise<void>((resolve, reject) => {
      this.ws.onopen = () => resolve()
      this.ws.onclose = () => reject(new Error("CDP WebSocket 已关闭"))
    })
  }

  /** 附加到实例里的第一个 page target(等价 TauriBrowserBackend.ensureConn)。 */
  static async attach(port: number): Promise<CdpPage> {
    let targets: Array<{ type?: string; webSocketDebuggerUrl?: string }>
    try {
      targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as typeof targets
    } catch (e) {
      throw new Error(`连不上 CDP 端口 ${port}——先跑 launch_clean_edge.sh 起 Edge(${e})`)
    }
    const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl)
    if (!page?.webSocketDebuggerUrl) throw new Error("CDP: 未找到可附加的页面 target")
    const inst = new CdpPage(page.webSocketDebuggerUrl)
    await inst.ready
    return inst
  }

  private handle(text: string): void {
    let msg: { id?: number; result?: any; error?: { message?: string } }
    try {
      msg = JSON.parse(text)
    } catch {
      return
    }
    if (msg.id == null) return // 事件帧(Page.*/Runtime.* 通知),无 id
    const p = this.pending.get(msg.id)
    if (!p) return
    this.pending.delete(msg.id)
    if (msg.error) p.reject(new Error(msg.error.message ?? "CDP error"))
    else p.resolve(msg.result)
  }

  private failAll(err: Error): void {
    for (const p of this.pending.values()) p.reject(err)
    this.pending.clear()
  }

  private async send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    await this.ready
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        this.ws.send(JSON.stringify({ id, method, params }))
      } catch (e) {
        this.pending.delete(id)
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
  }

  // ── BrowserBackend ────────────────────────────────────────────────────────
  // 默认 awaitPromise/returnByValue = true,与 playwright 的 page.evaluate 语义一致。

  async evaluate<T = unknown>(
    expression: string,
    opts?: { awaitPromise?: boolean; returnByValue?: boolean },
  ): Promise<T> {
    const r = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: opts?.awaitPromise ?? true,
      returnByValue: opts?.returnByValue ?? true,
    })
    if (r?.exceptionDetails) {
      const d = r.exceptionDetails
      throw new Error(`页面内 evaluate 抛错: ${d.text ?? ""} ${d.exception?.description ?? ""}`)
    }
    return r?.result?.value as T
  }

  async getCookies(url?: string): Promise<Record<string, string>> {
    const r = await this.send("Network.getCookies", url ? { urls: [url] } : {})
    const out: Record<string, string> = {}
    for (const c of (r?.cookies ?? []) as Array<{ name: string; value: string }>) out[c.name] = c.value
    return out
  }

  async close(): Promise<void> {
    try {
      this.ws.close()
    } catch {
      /* 已关 */
    }
    this.failAll(new Error("CDP 连接已关闭"))
  }
}

/** 各 channel 的示例 info(browser-sim 用;来自原 shared backend.ts,保持同参)。 */
function exampleInfo(key: string): Record<string, string> {
  switch (key) {
    case "weibo:user": return { uid: "1195230310" } // 微博·何炅(desktop 测试源)
    case "xhs:user": return { user_id: "593032945e87e77791e03696" } // 小红书·小宇菇菇(desktop 测试源)
    default: return {}
  }
}

async function main() {
  const key = process.argv[2]
  if (!key) {
    console.error("用法: bun run packages/crawler/src/example/browser-sim.ts weibo:user|xhs:user")
    process.exit(1)
  }
  injectNodeHost()

  const page = await CdpPage.attach(PORT)
  // 门面是 getter 只读,setHostCaps 需完整 caps(shape 与 tauri host 一致 + browser)。
  setHostCaps({
    http: nodeBackend(),
    js: nodeJsBackend(),
    storage: memStorage(),
    browser: page,
  })

  const info = exampleInfo(key)
  const { listChannels } = await import("../index.ts")
  const channels = await listChannels()
  const channel = channels.find((c: any) => c.key === key)
  if (!channel) throw new Error(`未找到 channel: ${key}`)

  console.log(`[browser-sim] 抓取 ${key}`, info, `(CDP :${PORT})`)
  const source = channel.getSource(info)
  // fetch() 直出 RSS 2.0 XML 字符串。打印前 400 字符看是否有条目。
  const xml = await source.fetch()
  console.log(`[browser-sim] RSS XML 长度: ${xml.length}`)
  console.log(xml.slice(0, 400))
  await page.close() // 只断 CDP,不杀 Edge(实例由 launch_clean_edge.sh 管,留着继续调试)
  process.exit(0)
}

main().catch((e) => {
  console.error("[browser-sim] 失败:", e)
  process.exit(1)
})
