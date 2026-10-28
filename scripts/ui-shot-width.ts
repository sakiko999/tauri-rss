/**
 * ui-shot-width —— 指定视口宽度截图（响应式复核）。
 * 用法: bun scripts/ui-shot-width.ts <width> <outPng> [url]
 */
const PORT = Number(process.env.CDP_PORT ?? 9222)
const BASE = process.env.APP_URL ?? "http://localhost:1420"
const width = Number(process.argv[2] ?? 1000)
const out = process.argv[3] ?? `tmp/w${width}.png`
const url = process.argv[4] ?? `${BASE}/v/tab:all`

const list = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()) as Array<{
  type: string
  url: string
  webSocketDebuggerUrl: string
}>
const page = list.find((t) => t.type === "page" && t.url.startsWith(BASE))!
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map<number, (v: any) => void>()
ws.addEventListener("message", (e) => {
  const m = JSON.parse(String(e.data)) as { id?: number; result?: any }
  if (m.id === undefined) return
  const p = pending.get(m.id)
  if (p) {
    pending.delete(m.id)
    p(m.result)
  }
})
const send = (method: string, params: Record<string, unknown> = {}) =>
  new Promise<any>((r) => {
    const i = ++id
    pending.set(i, r)
    ws.send(JSON.stringify({ id: i, method, params }))
  })
await new Promise<void>((r) => ws.addEventListener("open", () => r()))
const ev = async (expression: string) =>
  (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.value
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false })
await ev(`location.href = ${JSON.stringify(url)}`)
await sleep(3000)
const s = await send("Page.captureScreenshot", { format: "png" })
await Bun.write(out, Buffer.from(s.data, "base64"))
console.log("✔", out)
await send("Emulation.clearDeviceMetricsOverride")
ws.close()
