/**
 * ui-shots-all —— 全模块截图(含所有设置 tab、各类弹窗与状态)。
 * 逐张人工/模型复核用。用法: bun scripts/ui-shots-all.ts [outDir]
 */
import { mkdirSync } from "node:fs"

const PORT = Number(process.env.CDP_PORT ?? 9222)
const BASE = process.env.APP_URL ?? "http://localhost:1420"
const OUT = process.argv[2] ?? "tmp/shots-all"
mkdirSync(OUT, { recursive: true })

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
async function shot(name: string) {
  const s = await send("Page.captureScreenshot", { format: "png" })
  if (!s?.data) {
    console.log("✖", name)
    return
  }
  await Bun.write(`${OUT}/${name}.png`, Buffer.from(s.data, "base64"))
  console.log("✔", name)
}
async function goto(node: string) {
  const url = node.startsWith("/") ? BASE + node : `${BASE}/v/${encodeURIComponent(node)}`
  await ev(`location.href = ${JSON.stringify(url)}`)
  await sleep(3000)
}
/** 用 sel 定位并可信点击。 */
async function click(sel: string, text?: string) {
  const box = await ev(`(() => {
    const els=[...document.querySelectorAll(${JSON.stringify(sel)})];
    const e=${text ? `els.find(x=>(x.textContent||'').includes(${JSON.stringify(text)}))` : "els[0]"};
    if(!e) return null; e.scrollIntoView({block:'center'});
    const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};
  })()`)
  if (!box) return false
  await sleep(150)
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y, buttons: 0 })
  await sleep(80)
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
  await sleep(900)
  return true
}
/** 命令面板会挡住点击 —— 用 Ctrl+K 确保关闭。 */
async function closePalette() {
  const open = await ev(`!!document.querySelector('.palette')`)
  if (open) {
    await ev(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true,cancelable:true}))`)
    await sleep(400)
  }
}

// ── 1. 主视图(全部 6 个内容 tab + 智能订阅 + 分组)────────────────────────
for (const [n, node] of [
  ["01-all", "tab:all"],
  ["02-article-list", "tab:article"],
  ["03-video", "tab:video"],
  ["04-audio", "tab:audio"],
  ["05-live", "tab:live"],
  ["06-social", "tab:social"],
  ["07-today", "today"],
  ["08-unread", "unread"],
  ["09-starred", "starred"],
  ["10-hot", "s-hot-weibo"],
] as Array<[string, string]>) {
  await goto(node)
  await closePalette()
  await shot(n)
}

// ── 2. 文章正文(点开一篇)──────────────────────────────────────────────
await goto("tab:article")
await closePalette()
await click(".list-row")
await sleep(1500)
await shot("11-article-detail")

// ── 3. 设置:全部 5 个 tab ───────────────────────────────────────────────
for (const t of ["appearance", "reading", "playback", "subscriptions", "diagnostics"]) {
  await goto(`/v/page%3Asettings?tab=${t}`)
  await closePalette()
  await shot(`12-settings-${t}`)
}

// ── 4. 发现 / 账号 ──────────────────────────────────────────────────────
await goto("page:discover")
await closePalette()
await shot("13-discover")
await goto("page:account")
await closePalette()
await shot("14-account")

// ── 5. 弹窗:添加订阅(搜索模式 / 按渠道配置)─────────────────────────────
await goto("tab:all")
await closePalette()
await click('button[aria-label="添加订阅"]')
await sleep(1200)
await shot("15-dialog-add-search")
await click(".add-mode button", "按渠道配置")
await sleep(800)
await shot("16-dialog-add-manual")
await ev(`document.querySelector('[aria-label=关闭]')?.click()`)
await sleep(600)

// ── 6. 弹窗:编辑订阅(含 radix Select 下拉展开)──────────────────────────
await goto(`/v/page%3Asettings?tab=subscriptions`)
await closePalette()
await click('.table button[aria-label="编辑"]')
await sleep(1000)
await shot("17-dialog-edit-sub")
await click(".modal .select")
await sleep(700)
await shot("18-dialog-edit-select-open")
await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)
await sleep(400)
await ev(`document.querySelector('.modal [aria-label=关闭]')?.click()`)
await sleep(600)

// ── 7. 弹窗:社交详情 ────────────────────────────────────────────────────
await goto("tab:social")
await closePalette()
await click(".social-card")
await sleep(2000)
await shot("19-dialog-social-detail")
await ev(`document.querySelector('.modal [aria-label=关闭]')?.click()`)
await sleep(600)

// ── 8. 命令面板 ─────────────────────────────────────────────────────────
await goto("tab:all")
await sleep(500)
await ev(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true,cancelable:true}))`)
await sleep(800)
await shot("20-command-palette")
await closePalette()

// ── 9. 空态 / 错误态 ────────────────────────────────────────────────────
await goto("starred")
await closePalette()
await shot("21-empty-starred")
await ev(
  `(() => { const i=document.querySelector('.titlebar-search input'); const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(i,'zzz-none'); i.dispatchEvent(new Event('input',{bubbles:true})); return 1 })()`,
)
await sleep(1200)
await shot("22-state-no-search-result")
await ev(
  `(() => { const i=document.querySelector('.titlebar-search input'); const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(i,''); i.dispatchEvent(new Event('input',{bubbles:true})); return 1 })()`,
)
await sleep(800)

console.log("done:", OUT)
ws.close()
