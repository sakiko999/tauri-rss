/**
 * ui-design-audit —— 可量化的 UI 设计审计(不是审美意见,是测量)。
 * 连到运行的 dev 实例,在若干视图上量:
 *   - 文字对比度(WCAG AA 4.5:1 正文 / 3:1 大字)
 *   - 点击目标尺寸(<24px 触控下限;桌面 <28 偏小)
 *   - 字号分布(是否有 <11px 的难读小字)
 *   - 间距节奏(同一容器内 gap 是否杂多)
 *   - 层级(标题与正文的字号/字重是否拉开)
 * 用法: bun scripts/ui-design-audit.ts [nodeId...]
 */
const PORT = Number(process.env.CDP_PORT ?? 9222)
const BASE = process.env.APP_URL ?? "http://localhost:1420"

const list = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()) as Array<{
  type: string
  webSocketDebuggerUrl: string
}>
const page = list.find((t) => t.type === "page" && t.url.startsWith(BASE))
if (!page) throw new Error("没有可附加的页面(确认 bun run tauri 在跑)")

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
  if (r.exceptionDetails) return { __err: r.exceptionDetails.text }
  return r.result?.value
}

const AUDIT = `(() => {
  // ── 颜色工具 ──
  // ⚠️ 主题令牌是 oklch();getComputedStyle 会原样返回,用正则抠数字会把 L/C/H
  // 当成 RGB(实测全变成 cr:1 的假结果)。必须让浏览器自己解析 → canvas 填色取像素。
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const cache = new Map();
  const color = (css) => {
    if (!css || css === 'transparent' || css === 'rgba(0, 0, 0, 0)') return { r:0,g:0,b:0,a:0 };
    if (cache.has(css)) return cache.get(css);
    cx.clearRect(0,0,1,1);
    cx.fillStyle = '#000';         // 先铺黑,便于判断半透明
    cx.fillStyle = css;
    cx.fillRect(0,0,1,1);
    const d = cx.getImageData(0,0,1,1).data;
    // 重新用黑底 alpha 混合:先测全透明
    const out = { r:d[0], g:d[1], b:d[2], a:d[3]/255 };
    cache.set(css, out);
    return out;
  };
  const opaque = (css) => { const c = color(css); return c.a >= 0.5 ? c : null };
  const lum = ({r,g,b}) => { const f=(v)=>{v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4)}; return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b) };
  const ratio = (a,b) => { const l1=lum(a), l2=lum(b); return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05) };
  /** 沿祖先链合成背景:自底向上找第一个实底,再把途中的半透明层**逐层叠加**上去。
   *  ⚠️ 曾只取「第一个不透明背景」,把半透明层直接丢弃 —— 于是白色文字的暗色半透明
   *  徽标(.card-duration 底 78% 深色 + 白字)被按浅色页底算成 cr=1.08 的假违规
   *  (真实合成后 11.2:1)。反之深字+深半透明底会被误判为合格(假阴性)。 */
  const bgOf = (el) => {
    const layers = [];
    let n = el;
    while (n) {
      const c = color(getComputedStyle(n).backgroundColor);
      if (c.a > 0.95) {
        layers.push(c); // 实底(最底层)
        break;
      }
      if (c.a > 0.05) layers.push(c); // 半透明层,待叠加
      n = n.parentElement;
    }
    if (!layers.length) return { r: 18, g: 18, b: 20, a: 1 };
    // 自底向上合成。⚠️ color() 把颜色对黑底预乘过(rgb 已是 src*α),故「over」公式
    // 用预乘源:result = src_premul + dst*(1-α)(不要再乘 α,否则暗一倍)。
    let acc = layers[layers.length - 1];
    if (acc.a <= 0.95) acc = { r: 18, g: 18, b: 20, a: 1 }; // 全链无实底 → 兜深色底
    for (let i = layers.length - 2; i >= 0; i--) {
      const c = layers[i];
      acc = {
        r: Math.round(c.r + acc.r * (1 - c.a)),
        g: Math.round(c.g + acc.g * (1 - c.a)),
        b: Math.round(c.b + acc.b * (1 - c.a)),
        a: 1,
      };
    }
    return acc;
  };

  const contrastIssues = [], smallTargets = [], tinyText = [], fontSizes = {}, gaps = {};

  for (const el of document.querySelectorAll('body *')) {
    // 跳过 dev overlay（标签/工具栏会把小点击目标、字号、对比度统计打成假阳性）
    if (el.closest('[data-dev-overlay]')) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;

    // 文字节点:对比度 + 字号
    const txt = (el.textContent || '').trim();
    const isLeafText = el.children.length === 0 && txt.length > 0;
    if (isLeafText) {
      const fs = parseFloat(cs.fontSize);
      fontSizes[Math.round(fs)] = (fontSizes[Math.round(fs)]||0)+1;
      if (fs < 11.5) tinyText.push({ cls: String(el.className).slice(0,32), fs: Math.round(fs*10)/10, txt: txt.slice(0,14) });
      const fg = opaque(cs.color);
      if (fg && fg.a > 0.3) {
        const bg = bgOf(el);
        const cr = ratio(fg, bg);
        const bold = parseInt(cs.fontWeight,10) >= 600;
        const large = fs >= 18.66 || (fs >= 14 && bold);
        const need = large ? 3 : 4.5;
        if (cr < need) contrastIssues.push({ cls: String(el.className).slice(0,32), cr: Math.round(cr*100)/100, need, fs: Math.round(fs*10)/10, txt: txt.slice(0,18), fg: cs.color, bg: 'rgb('+bg.r+','+bg.g+','+bg.b+')' });
      }
    }

    // 点击目标尺寸
    if (el.matches('button, a[href], [role="button"], input[type="checkbox"], select')) {
      const w = r.width, h = r.height;
      // 卡片类整体可点不算小;只挑真正的控件
      const cardish = el.matches('.card, .social-card, .list-row, .hot-row, .queue-row, .nav-row, .palette-item, .cand');
      if (!cardish && (w < 28 || h < 28)) smallTargets.push({ cls: String(el.className).slice(0,34), w: Math.round(w), h: Math.round(h), aria: el.getAttribute('aria-label'), txt: txt.slice(0,12) });
    }

    // 间距节奏
    if (cs.display.includes('flex') || cs.display === 'grid') {
      const g = cs.rowGap === cs.columnGap ? cs.rowGap : cs.rowGap + '/' + cs.columnGap;
      if (g && g !== 'normal' && g !== '0px') {
        const key = String(el.className).slice(0,30);
        (gaps[key] ??= new Set()).add(g);
      }
    }
  }
  // 杂多 gap:同一容器出现 3+ 种
  const inconsistentGaps = Object.entries(gaps).filter(([, s]) => s.size >= 3).map(([k, s]) => ({ cls: k, gaps: [...s] }));

  const uniqContrast = [...new Set(contrastIssues.map(c => JSON.stringify(c)))].map(s=>JSON.parse(s)).slice(0, 20);
  const uniqSmall = [...new Set(smallTargets.map(c => JSON.stringify(c)))].map(s=>JSON.parse(s)).slice(0, 20);
  const uniqTiny = [...new Set(tinyText.map(c => JSON.stringify(c)))].map(s=>JSON.parse(s)).slice(0, 20);
  return JSON.stringify({
    path: location.pathname,
    contrastIssues: uniqContrast.length, contrast: uniqContrast,
    smallTargets: uniqSmall.length, targets: uniqSmall,
    tinyTextCount: uniqTiny.length, tiny: uniqTiny,
    fontSizes, inconsistentGaps: inconsistentGaps.slice(0, 8),
  }, null, 1)
})()`

const nodes = process.argv.slice(2)
const targets = nodes.length
  ? nodes
  : ["tab:all", "tab:article", "page:settings", "page:account", "page:discover", "s-video-bili"]
for (const n of targets) {
  const url = n.startsWith("/") ? n : `/v/${encodeURIComponent(n)}`
  await evaluate(`location.href = ${JSON.stringify(BASE + url)}`)
  await new Promise((r) => setTimeout(r, 2600))
  const out = await evaluate(AUDIT)
  console.log(`\n===== ${n} =====`)
  console.log(typeof out === "string" ? out : JSON.stringify(out))
}
ws.close()
