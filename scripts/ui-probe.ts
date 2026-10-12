/**
 * ui-probe —— 连到**正在运行的桌面 dev 实例**做交互巡检(零依赖,只走 CDP)。
 *
 * 桌面 WebView 走 Rust 隧道,devtools 里看不到真实网络;而布局/交互类问题
 * (错位、被遮挡、渲染失败)在源码里也看不出来。这个探针让我可以直接在真机上
 * 量 DOM、打可信鼠标事件,而不是靠读代码猜。
 *
 * 前提:实例带 CDP 端口 9222 —— `bun run tauri` 已自动叠 tauri.conf.dev.json 开启。
 *
 * 用法:
 *   bun scripts/ui-probe.ts eval "<js 表达式>"         # 在页面里求值并打印结果
 *   bun scripts/ui-probe.ts click "<selector>"        # 可信点击(悬停→按下→抬起)
 *   bun scripts/ui-probe.ts clickText "<sel>" "<文本>" # 按文本找元素点击
 *   bun scripts/ui-probe.ts goto "<nodeId|/path>"     # 导航 + 等渲染 + 巡检
 *   bun scripts/ui-probe.ts audit                     # 只巡检当前页
 */
const PORT = Number(process.env.CDP_PORT ?? 9222)
const BASE = process.env.APP_URL ?? "http://localhost:1420"

interface Target {
  type: string
  webSocketDebuggerUrl: string
}

async function connect() {
  const list = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()) as Target[]
  const page = list.find((t) => t.type === "page" && t.url.startsWith(BASE))
  if (!page) throw new Error(`没有可附加的页面 target(端口 ${PORT} 上)。确认 bun run tauri 在跑。`)
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map<number, (v: any) => void>()
  await new Promise<void>((res) => ws.addEventListener("open", () => res()))
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
    new Promise<any>((res) => {
      const myId = ++id
      pending.set(myId, res)
      ws.send(JSON.stringify({ id: myId, method, params }))
    })
  const evaluate = async (expression: string) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) return { __err: r.exceptionDetails.text ?? String(r.exceptionDetails).slice(0, 400) }
    return r.result?.value
  }
  return { ws, send, evaluate }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const emit = (v: unknown) => console.log(typeof v === "string" ? v : JSON.stringify(v, null, 1))

/** 巡检当前页:可测量的布局/交互异常。 */
const AUDIT_JS = `(() => {
  const issues = [];
  const W = innerWidth, H = innerHeight;
  const push = (o) => { if (issues.length < 40) issues.push(o) };
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (el.children.length === 0) {
      const txt = (el.textContent || '').trim();
      if (txt.length > 2 && r.width > 0) {
        const lh = parseFloat(cs.lineHeight) || 16;
        const lines = Math.round(r.height / lh);
        const charsPerLine = r.width / (parseFloat(cs.fontSize) || 14);
        if (lines >= 3 && charsPerLine < 1.2) push({ k: 'text-vertical(逐字竖排)', cls: String(el.className).slice(0,40), txt: txt.slice(0,16), w: Math.round(r.width) });
      }
    }
    if (el.scrollWidth > el.clientWidth + 8 && cs.overflowX === 'visible' && el.clientWidth > 0)
      push({ k: 'h-overflow', cls: String(el.className).slice(0,40), cw: el.clientWidth, sw: el.scrollWidth });
    if (r.left > W + 2 || r.right < -2) push({ k: 'offscreen-x', cls: String(el.className).slice(0,40) });
  }
  // 可点元素中心是否被**不相关**元素遮挡(排除滚动裁剪的祖先)
  let covered = 0;
  for (const el of document.querySelectorAll('button, a[href], [role="button"]')) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const cx = r.left + r.width/2, cy = r.top + r.height/2;
    if (cx < 0 || cy < 0 || cx > W || cy > H) continue; // 视口外(需滚动)
    const hit = document.elementFromPoint(cx, cy);
    if (!hit || el.contains(hit) || hit.contains(el)) continue;
    let a = hit.parentElement, clipped = false;
    while (a) { const s = getComputedStyle(a); if (s.overflow !== 'visible' || (s.overflowY !== 'visible' && r.bottom > a.getBoundingClientRect().bottom)) { clipped = true; break } a = a.parentElement }
    if (!clipped) { covered++; push({ k: 'click-covered(被遮挡)', cls: String(el.className).slice(0,40), hit: String((hit.className||hit.tagName)).slice(0,40) }) }
  }
  const brokenImgs = [...document.querySelectorAll('img')].filter(i => i.complete && i.naturalWidth === 0).length;
  const uniq = [...new Set(issues.map(o => JSON.stringify(o)))].map(s => JSON.parse(s));
  return JSON.stringify({
    path: location.pathname + location.search,
    view: document.querySelector('.app-body')?.dataset.view,
    imgs: document.querySelectorAll('img').length, brokenImgs, coveredClicks: covered,
    issueCount: uniq.length, issues: uniq.slice(0, 20),
  }, null, 1);
})()`

async function clickAt(send: any, x: number, y: number) {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 })
  await sleep(100)
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 })
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 1, clickCount: 1 })
}

async function main() {
  const [, , cmd, ...args] = process.argv
  const { ws, send, evaluate } = await connect()
  try {
    switch (cmd) {
      case "eval":
        emit(await evaluate(args.join(" ")))
        break
      case "click":
      case "clickText": {
        const [sel, text] = args
        const box = await evaluate(`(() => {
          const els = [...document.querySelectorAll(${JSON.stringify(sel)})];
          const el = ${cmd === "clickText" ? `els.find(e => (e.textContent||'').includes(${JSON.stringify(text)}))` : "els[0]"};
          if (!el) return null;
          el.scrollIntoView({ block: 'center' });
          const r = el.getBoundingClientRect();
          return { x: r.x + r.width/2, y: r.y + r.height/2 };
        })()`)
        if (!box || (box as any).__err) throw new Error(`找不到目标: ${sel} ${text ?? ""}`)
        await sleep(200)
        const b2 = await evaluate(`(() => { const els=[...document.querySelectorAll(${JSON.stringify(sel)})]; const el=${cmd === "clickText" ? `els.find(e => (e.textContent||'').includes(${JSON.stringify(text)}))` : "els[0]"}; const r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2} })()`)
        await clickAt(send, (b2 as any).x, (b2 as any).y)
        await sleep(800)
        emit(await evaluate(`JSON.stringify({ path: location.pathname + location.search })`))
        break
      }
      case "goto": {
        const target = args[0]!
        const url = target.startsWith("/") ? target : `/v/${encodeURIComponent(target)}`
        await evaluate(`location.href = ${JSON.stringify(BASE + url)}`)
        await sleep(3500)
        emit(await evaluate(AUDIT_JS))
        break
      }
      case "audit":
        emit(await evaluate(AUDIT_JS))
        break
      default:
        console.log(`用法: ui-probe <eval|click|clickText|goto|audit> ...`)
    }
  } finally {
    ws.close()
  }
}

main().catch((e) => {
  console.error(String((e as Error)?.message ?? e))
  process.exit(1)
})
