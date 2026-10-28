/**
 * ui-shot —— 给运行中的 dev 实例的各个模块截图存档(Review 用)。
 * 用法: bun scripts/ui-shot.ts [outDir]
 */

import { mkdirSync } from "node:fs"

const PORT = Number(process.env.CDP_PORT ?? 9222)
const BASE = process.env.APP_URL ?? "http://localhost:1420"
const OUT = process.argv[2] ?? "tmp/shots"
mkdirSync(OUT, { recursive: true })

const list = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()) as Array<{
  type: string
  webSocketDebuggerUrl: string
}>
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
const evaluate = async (expression: string) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })
  return r.result?.value
}

const targets: Array<[string, string]> = [
  ["all", "tab:all"],
  ["reader-list", "tab:article"],
  ["live-grid", "tab:live"],
  ["social-masonry", "tab:social"],
  ["unread", "unread"],
  ["hot", "s-hot-weibo"],
  ["settings-appearance", "/v/page%3Asettings?tab=appearance"],
  ["settings-subs", "/v/page%3Asettings?tab=subscriptions"],
  ["settings-playback", "/v/page%3Asettings?tab=playback"],
  ["settings-diagnostics", "/v/page%3Asettings?tab=diagnostics"],
  ["discover", "page:discover"],
  ["account", "page:account"],
  // 播放页:需要先有点播内容可播 —— 取 bilibili 热门第一条。
  ["player-video", "__PLAY_VIDEO__"],
]

for (const [name, node] of targets) {
  let url: string
  if (node === "__PLAY_VIDEO__") {
    // 进订阅列表 → 点第一张卡 → 落到播放页。
    await evaluate(`location.href = ${JSON.stringify(BASE + "/v/s-video-bili")}`)
    await new Promise((r) => setTimeout(r, 2600))
    await evaluate(`document.querySelector('.card')?.click()`)
    await new Promise((r) => setTimeout(r, 9000))
    url = "PLAYER"
  } else {
    url = node.startsWith("/") ? BASE + node : `${BASE}/v/${encodeURIComponent(node)}`
    await evaluate(`location.href = ${JSON.stringify(url)}`)
    await new Promise((r) => setTimeout(r, 3200))
  }
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false })
  const data = shot?.data
  if (data) {
    await Bun.write(`${OUT}/${name}.png`, Buffer.from(data, "base64"))
    console.log(`✔ ${OUT}/${name}.png`)
  } else {
    console.log(`✖ ${name} (no data)`)
  }
}
console.log("done:", OUT)
ws.close()
