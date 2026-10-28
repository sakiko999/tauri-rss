/**
 * ui-resize —— 调整运行中 dev 实例的窗口尺寸(验证响应式断点用)。
 * 用法: bun scripts/ui-resize.ts <width> <height>
 */
const PORT = Number(process.env.CDP_PORT ?? 9222)
const BASE = process.env.APP_URL ?? "http://localhost:1420"
const list = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()) as Array<{
  type: string
  url: string
  webSocketDebuggerUrl: string
}>
// ⚠️ 必须按 URL 挑应用页面:DevTools 自己也是一个 page target,取第一个会挑到它。
const page = list.find((t) => t.type === "page" && t.url.startsWith(BASE))!
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map<number, (v: any) => void>()
const send = (method: string, params: Record<string, unknown> = {}) =>
  new Promise<any>((res) => {
    const myId = ++id
    pending.set(myId, res)
    ws.send(JSON.stringify({ id: myId, method, params }))
  })
ws.addEventListener("message", (e) => {
  const m = JSON.parse(String(e.data)) as { id?: number; result?: any }
  if (m.id === undefined) return
  const p = pending.get(m.id)
  if (p) {
    pending.delete(m.id)
    p(m.result)
  }
})
await new Promise<void>((res) => ws.addEventListener("open", () => res()))

const w = Number(process.argv[2] ?? 1440)
const h = Number(process.argv[3] ?? 900)
const win = await send("Browser.getWindowForTarget")
const windowId = win?.windowId
console.log("windowId:", windowId)
const r = await send("Browser.setWindowBounds", {
  windowId,
  bounds: { left: 40, top: 40, width: w, height: h, windowState: "normal" },
})
console.log("setWindowBounds:", JSON.stringify(r ?? "ok"))
await new Promise((res) => setTimeout(res, 900))
const inner = await send("Runtime.evaluate", {
  expression: "JSON.stringify({w:innerWidth,h:innerHeight})",
  returnByValue: true,
})
console.log("inner:", inner?.result?.value)
ws.close()
