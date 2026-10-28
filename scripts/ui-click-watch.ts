/**
 * ui-click-watch —— 可信点击一个元素,同时捕获控制台错误(调撤销等异步链路的排查用)。
 * 用法: bun scripts/ui-click-watch.ts "<selector>" [waitMs]
 */
const PORT = Number(process.env.CDP_PORT ?? 9222)
const BASE = process.env.APP_URL ?? "http://localhost:1420"
const sel = process.argv[2]!
const wait = Number(process.argv[3] ?? 3000)

const list = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()) as Array<{
  type: string
  url: string
  webSocketDebuggerUrl: string
}>
const page = list.find((t) => t.type === "page" && t.url.startsWith(BASE))!
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map<number, (v: any) => void>()
const logs: string[] = []
ws.addEventListener("message", (e) => {
  const m = JSON.parse(String(e.data)) as { id?: number; result?: any; method?: string; params?: any }
  if (m.id !== undefined) {
    const p = pending.get(m.id)
    if (p) {
      pending.delete(m.id)
      p(m.result)
    }
    return
  }
  if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params?.type)) {
    logs.push(
      `[${m.params.type}] ${(m.params.args ?? [])
        .map((a: any) => a.value ?? a.description ?? "")
        .join(" ")
        .slice(0, 300)}`,
    )
  }
  if (m.method === "Runtime.exceptionThrown") {
    logs.push(
      `[exception] ${m.params?.exceptionDetails?.exception?.description?.slice(0, 300) ?? m.params?.exceptionDetails?.text}`,
    )
  }
})
const send = (method: string, params: Record<string, unknown> = {}) =>
  new Promise<any>((r) => {
    const i = ++id
    pending.set(i, r)
    ws.send(JSON.stringify({ id: i, method, params }))
  })
await new Promise<void>((r) => ws.addEventListener("open", () => r()))
await send("Runtime.enable")
const evaluate = async (expression: string) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) return { __err: r.exceptionDetails.text }
  return r.result?.value
}
const box = await evaluate(
  `(() => { const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2} })()`,
)
if (!box || (box as any).__err) {
  console.error("not found:", sel)
  process.exit(1)
}
console.log("clicking", sel, JSON.stringify(box))
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y, buttons: 0 })
await new Promise((r) => setTimeout(r, 100))
await send("Input.dispatchMouseEvent", {
  type: "mousePressed",
  x: box.x,
  y: box.y,
  button: "left",
  buttons: 1,
  clickCount: 1,
})
await send("Input.dispatchMouseEvent", {
  type: "mouseReleased",
  x: box.x,
  y: box.y,
  button: "left",
  buttons: 1,
  clickCount: 1,
})
await new Promise((r) => setTimeout(r, wait))
console.log("console:", logs.length ? logs.join("\n") : "(none)")
const after = await evaluate(
  `JSON.stringify({ toast: [...document.querySelectorAll('.toast')].map(t=>t.textContent.replace(/\\s+/g,' ').trim().slice(0,50)), groups: [...document.querySelectorAll('.group-head .nav-label')].map(e=>e.textContent) })`,
)
console.log("after:", typeof after === "string" ? after : JSON.stringify(after))
ws.close()
