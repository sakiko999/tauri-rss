/**
 * ui-rail-check —— 复现「窄栏里 group-empty 变竖排」，并验证修复。
 * 用法: bun scripts/ui-rail-check.ts [widths...]
 * 用 CDP Emulation.setDeviceMetricsOverride 改视口宽度，逐宽度量 .group-empty / .nav-label 的实际盒宽。
 */
const PORT = Number(process.env.CDP_PORT ?? 9222)
const BASE = process.env.APP_URL ?? "http://localhost:1420"
const widths = process.argv.slice(2).length ? process.argv.slice(2).map(Number) : [1600, 1100, 1079, 1000, 900, 820]

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
const ev = async (expression: string) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })
  return r.result?.value
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

for (const w of widths) {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(600)
  const r = await ev(`(() => {
    const rail = document.querySelector('.rail');
    const px = (e) => { if(!e) return null; const b=e.getBoundingClientRect(); const cs=getComputedStyle(e); return { w:Math.round(b.width), h:Math.round(b.height), display:cs.display } };
    return JSON.stringify({
      inner: window.innerWidth,
      railW: Math.round(rail.getBoundingClientRect().width),
      railCls: rail.className,
      emptyInRail: document.querySelectorAll('.rail .group-empty').length,
      groupEmpty: px(document.querySelector('.rail .group-empty')),
      navLabel: px(document.querySelector('.rail .nav-label')),
      subRow: px(document.querySelector('.rail .sub-row')),
    })
  })()`)
  const o = JSON.parse(r)
  // 竖排判定:可见且宽 < 40px
  const vert = (b: any) => b && b.display !== "none" && b.w < 40 && b.h > 40
  const flag = vert(o.groupEmpty) ? "  ✖ group-empty 竖排" : ""
  console.log(
    `${String(w).padStart(5)} → rail=${o.railW}px  empty=${o.groupEmpty ? `w${o.groupEmpty.w}/h${o.groupEmpty.h}/${o.groupEmpty.display}` : "-"}  label=${o.navLabel ? `w${o.navLabel.w}/${o.navLabel.display}` : "-"}${flag}`,
  )
}
await send("Emulation.clearDeviceMetricsOverride")
ws.close()
