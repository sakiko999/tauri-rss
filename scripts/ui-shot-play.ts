/**
 * ui-shot-play —— 截播放页(控件可见)。用法: bun scripts/ui-shot-play.ts [itemId] [outPng]
 */
const PORT = Number(process.env.CDP_PORT ?? 9222)
const BASE = process.env.APP_URL ?? "http://localhost:1420"
const out = process.argv[3] ?? "tmp/play.png"

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
const ev = async (x: string) =>
  (await send("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true })).result?.value
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const itemId =
  process.argv[2] ??
  (await ev(
    `(()=>{const s=window.__store.getState(); const v=s.allItems.find(i=>i.kind==="video"); return v?v.id:""})()`,
  ))
await ev(`location.href = ${JSON.stringify(BASE)}/play/${encodeURIComponent(itemId)}`)
await sleep(6000)
// 悬停进画面让控件显形
const box = await ev(
  `(()=>{const e=document.querySelector('.stage'); const r=e.getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2,w:Math.round(r.width),h:Math.round(r.height)})})()`,
)
const b = JSON.parse(box)
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: b.x, y: b.y, buttons: 0 })
await sleep(900)
const s = await send("Page.captureScreenshot", { format: "png" })
await Bun.write(out, Buffer.from(s.data, "base64"))
// 量圆角
console.log(
  await ev(
    `(()=>{const q=(sel)=>{const e=document.querySelector(sel); if(!e) return null; const cs=getComputedStyle(e); const r=e.getBoundingClientRect(); return {w:Math.round(r.width),h:Math.round(r.height),tl:cs.borderTopLeftRadius,bl:cs.borderBottomLeftRadius}}; return JSON.stringify({shell:q('.stage > *'),controls:q('.stage .rounded-b-xl')})})()`,
  ),
)
console.log("✔", out)
ws.close()
