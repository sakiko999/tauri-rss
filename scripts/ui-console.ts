/**
 * ui-console —— 连到运行中的 dev 实例,开 Log/Runtime 域,**捕获控制台错误与 React 告警**,
 * 然后依次访问若干视图。用法: bun scripts/ui-console.ts [nodeId...]
 *
 * 为什么值得单列:React 的 key 重复 / hooks 顺序 / 非法 DOM 嵌套 / 未捕获 promise 都只
 * 在控制台冒泡,界面看起来照常渲染 —— 靠肉眼看不出,靠静态检查也查不到。
 */
const PORT = Number(process.env.CDP_PORT ?? 9222)
const BASE = process.env.APP_URL ?? "http://localhost:1420"

const list = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()) as Array<{
  type: string
  webSocketDebuggerUrl: string
}>
const page = list.find((t) => t.type === "page" && t.url.startsWith(BASE))
if (!page) throw new Error("没有可附加的页面(确认 bun run tauri 在跑)")

const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map<number, (v: any) => void>()
const logs: string[] = []
ws.addEventListener("message", (e) => {
  const m = JSON.parse(String(e.data)) as { id?: number; result?: any; method?: string; params?: any }
  if (m.id !== undefined) {
    const p = pending.get(m.id)
    if (p) { pending.delete(m.id); p(m.result) }
    return
  }
  if (m.method === "Log.entryAdded") {
    const en = m.params?.entry
    if (en && (en.level === "error" || en.level === "warning")) logs.push(`[${en.level}] ${en.text} ${en.url ? "@" + en.url : ""}`)
  }
  if (m.method === "Runtime.consoleAPICalled") {
    const { type, args } = m.params ?? {}
    if (type === "error" || type === "warning") {
      const text = (args ?? []).map((a: any) => a.value ?? a.description ?? a.type).join(" ").slice(0, 400)
      logs.push(`[console.${type}] ${text}`)
    }
  }
  if (m.method === "Runtime.exceptionThrown") {
    logs.push(`[exception] ${m.params?.exceptionDetails?.text ?? ""} ${m.params?.exceptionDetails?.exception?.description?.slice(0, 300) ?? ""}`)
  }
})
const send = (method: string, params: Record<string, unknown> = {}) =>
  new Promise<any>((res) => {
    const myId = ++id
    pending.set(myId, res)
    ws.send(JSON.stringify({ id: myId, method, params }))
  })
await new Promise<void>((res) => ws.addEventListener("open", () => res()))
await send("Log.enable")
await send("Runtime.enable")

const nodes = process.argv.slice(2)
const targets = nodes.length ? nodes : ["tab:all", "tab:article", "tab:live", "tab:social", "unread", "starred", "page:settings", "page:account", "page:discover"]
for (const n of targets) {
  const url = n.startsWith("/") ? n : `/v/${encodeURIComponent(n)}`
  logs.push(`--- goto ${url} ---`)
  await send("Runtime.evaluate", { expression: `location.href = ${JSON.stringify(BASE + url)}` })
  await new Promise((r) => setTimeout(r, 2200))
}

// 顺带触发一次命令面板 + 模态,覆盖更多组件
await send("Runtime.evaluate", {
  expression: `(() => { window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true,cancelable:true})); return 1 })()`,
})
await new Promise((r) => setTimeout(r, 800))

const meaningful = logs.filter((l) => !l.includes("favicon") && !l.includes("Download the React DevTools") && !l.includes("--- goto"))
console.log(meaningful.length ? meaningful.join("\n") : "✔ 没有控制台错误/告警")
ws.close()
