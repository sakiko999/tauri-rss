/**
 * ui-play-check —— 播放矩阵巡检:遍历 video / live / audio / youtube 各一条,**真实播放**,
 * 报每条是否起播(currentTime 推进 / 非 paused)。
 *
 * 为什么需要:player 的选流/兜底/autoplay 逻辑靠读代码判断不可靠 —— 真实播放才是权威
 * (本会话 `hasPlayable` 改判 `!!url` 曾把 bili DASH 流(url 恒空串)全判成不可播,
 *  播客 `preload=none` 死锁也只在真机上才暴露)。
 *
 * 用法(需 `bun run tauri` 在跑,9222 已开):
 *   bun scripts/ui-play-check.ts            # 各格式各一条
 *   bun scripts/ui-play-check.ts --wait 12  # 增加每条的起播等待秒数(默认 9)
 */
const PORT = Number(process.env.CDP_PORT ?? 9222)
const BASE = process.env.APP_URL ?? "http://localhost:1420"
const waitArg = process.argv.indexOf("--wait")
const WAIT = waitArg >= 0 ? Number(process.argv[waitArg + 1]) * 1000 : 9000

const list = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()) as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>
const page = list.find((t) => t.type === "page" && t.url.startsWith(BASE))
if (!page) throw new Error(`没有可附加的页面 target(端口 ${PORT})。确认 bun run tauri 在跑。`)
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map<number, (v: any) => void>()
ws.addEventListener("message", (e) => {
  const m = JSON.parse(String(e.data)) as { id?: number; result?: any }
  if (m.id === undefined) return
  const p = pending.get(m.id)
  if (p) { pending.delete(m.id); p(m.result) }
})
await new Promise<void>((r) => ws.addEventListener("open", () => r()))
const send = (method: string, params: Record<string, unknown> = {}) =>
  new Promise<any>((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (x: string) => (await send("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true })).result?.value
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// 各类各挑一条(url 倾向平台特征,便于定位)
const targets = JSON.parse(
  await ev(`(() => {
    const s = globalThis.__store; const items = s.getState().allItems || [];
    const pick = (k, re) => items.find(i => i.kind === k && (!re || re.test(i.url||'')))?.id;
    return JSON.stringify({
      "video-bili": pick('video', /bilibili/),
      "video-youtube": pick('video', /youtube/),
      live: pick('live'),
      audio: pick('audio'),
    });
  })()`),
)

let ok = 0, bad = 0
for (const [label, idv] of Object.entries(targets) as [string, string][]) {
  if (!idv) { console.log(`- ${label}: (无此类条目,跳过)`); continue }
  // ⚠️ PlayableMedia key=item.id → 换条目会重挂 video。导航后必须等「媒体元素出现且 src 变化」,
  // 否则读到上一条的残留状态(曾因此把 4 条都读成同一条 YouTube 的 0:43)。
  // ⚠️ 用 CDP `Page.navigate`(真导航)而非 location.href= ——后者被 react-router 的
  // startTransition 接管,同一 tick 内读到的还是旧页(曾 4 条全读成同一条)。
  await send("Page.navigate", { url: `${BASE}/play/${encodeURIComponent(idv)}` })
  const deadline = Date.now() + WAIT + 12000
  let ready = false
  while (Date.now() < deadline) {
    await sleep(800)
    const sid = await ev(`(() => { const m = document.querySelector('audio') || document.querySelector('video'); return (decodeURIComponent(location.pathname).includes(${JSON.stringify(idv)}) && m) ? 1 : 0 })()`)
    if (sid === 1) { ready = true; break }
  }
  await sleep(WAIT)
  const st = JSON.parse(
    await ev(`(() => {
      const m = document.querySelector('audio') || document.querySelector('video');
      return JSON.stringify({
        media: m ? m.tagName.toLowerCase() : null,
        t: Math.round(m?.currentTime || 0),
        paused: m?.paused, readyState: m?.readyState,
        canvas: !!document.querySelector('canvas'),
        stage: (document.querySelector('.stage')?.innerText || '').replace(/\\s+/g, ' ').slice(0, 60),
      });
    })()`),
  )
  const played = st.media && !st.paused && st.t > 0
  if (played) ok++; else bad++
  console.log(`${played ? "✓" : "✗"} ${label}: ${st.media} t=${st.t}s paused=${st.paused} rs=${st.readyState} canvas=${st.canvas} ${played ? "" : "｜" + st.stage}`)
}
console.log(`\n${ok} 起播 / ${bad} 未起播`)
process.exit(bad === 0 ? 0 : 1)
