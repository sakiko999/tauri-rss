/**
 * ui-shot-one —— 截当前页面（可选先点一个元素）。用于弹窗等临时态。
 * 用法: bun scripts/ui-shot-one.ts <outFile.png> [selector]
 */
const PORT = Number(process.env.CDP_PORT ?? 9222)
const BASE = process.env.APP_URL ?? "http://localhost:1420"
const out = process.argv[2] ?? "tmp/one.png"
const sel = process.argv[3]

const list = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()) as Array<{
  type: string
  url: string
  webSocketDebuggerUrl: string
}>
const page = list.find((t) => t.type === "page" && t.url.startsWith(BASE))!
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map<number, (v: any) => void>()
const send = (m: string, p: Record<string, unknown> = {}) =>
  new Promise<any>((r) => {
    const i = ++id
    pending.set(i, r)
    ws.send(JSON.stringify({ id: i, method: m, params: p }))
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
await new Promise<void>((r) => ws.addEventListener("open", () => r()))
const evaluate = async (expression: string) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })
  return r.result?.value
}
if (sel) {
  const box = await evaluate(
    `(() => { const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2} })()`,
  )
  if (box) {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y, buttons: 0 })
    await new Promise((r) => setTimeout(r, 120))
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
    await new Promise((r) => setTimeout(r, 2500))
  }
}
const shot = await send("Page.captureScreenshot", { format: "png" })
await Bun.write(out, Buffer.from(shot.data, "base64"))
console.log("✔", out)
ws.close()
