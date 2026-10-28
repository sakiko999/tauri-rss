/**
 * Numbered UI Overlay —— dev-only 安装入口与公共 API。
 *
 * 编号语义（用户最关心的两点）：
 *   1. **400 是“同屏标签数”上限，不是编号上限**。扫描只看当前挂载且在视口内的
 *      元素；虚拟列表滚出视口的条目不在 DOM 里，不会占用编号。超过 400 个可见
 *      元素时仍按视觉顺序编号，但只渲染前 400 个标签，工具栏显示 +N；编号本身
 *      不回收、不重排。
 *   2. **同一元素/条目在本路由会话内编号固定**。稳定键优先取 React fiber 上的
 *      业务 id（item.subscriptionId:id / sub.id / group.id），其次 data-* / 唯一 id /
 *      列表标题；滚出再滚回、DOM 节点重建都复用同一个 n。路由变化会重置编号
 *      （不同页面的“12 号”才有意义）；隐藏/显示覆盖层不会重置。
 */

import { isImeComposing } from "../../lib/ime.ts"
import { copyText } from "./clipboard.ts"
import { formatText, toJsonItem, toPublicEntry } from "./format.ts"
import { DEFAULT_HOTKEY, formatHotkey, matchHotkey, parseHotkey } from "./hotkey.ts"
import { selectLabels } from "./labels.ts"
import { NumberRegistry } from "./registry.ts"
import { OverlayView } from "./render.ts"
import { scanCandidates } from "./scan.ts"
import type { OverlayEntry, OverlayStats, PublicEntry, UiOverlayApi } from "./types.ts"

declare global {
  interface Window {
    __uiOverlay?: UiOverlayApi
  }
}

const STORAGE_KEY = "ui-dev-overlay"
/** 同屏标签上限（不是编号上限）。 */
const MAX_LABELS = 400
const SCAN_DEBOUNCE_MS = 120
const POINTER_SCAN_MS = 180
const POS_INTERVAL_MS = 80
const ROUTE_CHECK_MS = 400

interface Config {
  on: boolean
  hotkey: string
  extraSelector: string
  /** 只渲染区块标签（控件仍编号）。 */
  blocksOnly: boolean
}

let installed = false
let enabled = false
let view: OverlayView | null = null
let config: Config = { on: false, hotkey: DEFAULT_HOTKEY, extraSelector: "", blocksOnly: false }
let hk = parseHotkey(config.hotkey)
let entries: OverlayEntry[] = []
let overflow = 0
let stats: OverlayStats = {
  scans: 0,
  lastScanMs: 0,
  candidates: 0,
  blocks: 0,
  labels: 0,
  overflow: 0,
  keys: 0,
  maxN: 0,
}
const registry = new NumberRegistry()

let mutationObs: MutationObserver | null = null
let resizeObs: ResizeObserver | null = null
let observed = new Set<Element>()
let raf = 0
let lastPos = 0
let lastRoute = 0
let lastPointer = 0
let needScanAt = 0
let needPos = false
let lastHref = ""

function loadConfig(): Config {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { on: false, hotkey: DEFAULT_HOTKEY, extraSelector: "", blocksOnly: false }
    const p = JSON.parse(raw) as Partial<Config>
    return {
      on: p.on === true,
      hotkey: typeof p.hotkey === "string" && p.hotkey ? p.hotkey : DEFAULT_HOTKEY,
      extraSelector: typeof p.extraSelector === "string" ? p.extraSelector : "",
      blocksOnly: p.blocksOnly === true,
    }
  } catch {
    return { on: false, hotkey: DEFAULT_HOTKEY, extraSelector: "", blocksOnly: false }
  }
}

function saveConfig(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    // localStorage 不可用：忽略
  }
}

function routeChanged(): boolean {
  const href = location.pathname + location.search
  if (href === lastHref) return false
  lastHref = href
  registry.reset()
  return true
}

function isInOverlay(node: Node): boolean {
  const el = node instanceof Element ? node : node.parentElement
  return !!el?.closest("[data-dev-overlay]")
}

function scheduleScan(delay = SCAN_DEBOUNCE_MS): void {
  if (!enabled) return
  needScanAt = Math.min(needScanAt || Infinity, performance.now() + delay)
}

function syncResizeObs(): void {
  if (!resizeObs) return
  const next = new Set(entries.map((e) => e.el))
  for (const el of observed) if (!next.has(el)) resizeObs.unobserve(el)
  for (const el of next) if (!observed.has(el)) resizeObs.observe(el)
  observed = next
}

/** 扫描一次；render=true 时同步更新标签。返回本次编号后的条目。 */
function scanNow(render: boolean): OverlayEntry[] {
  const t0 = performance.now()
  const cands = scanCandidates(config.extraSelector)
  const withN: OverlayEntry[] = cands.map((c) => ({ ...c, n: registry.numberFor(c.key) }))
  entries = withN

  const picked = selectLabels(withN, config.blocksOnly, MAX_LABELS)
  const shown = picked.shown
  overflow = picked.overflow
  const drawing = render && enabled && !!view
  if (drawing) view!.setEntries(shown, overflow)
  syncResizeObs()

  stats = {
    scans: stats.scans + 1,
    lastScanMs: performance.now() - t0,
    candidates: withN.length,
    blocks: withN.reduce((n, e) => n + (e.block ? 1 : 0), 0),
    labels: drawing ? shown.length : 0,
    overflow,
    keys: registry.size(),
    maxN: registry.max(),
  }
  needPos = true
  return withN
}

function ensureFresh(): void {
  routeChanged()
  scanNow(enabled)
}

function attach(): void {
  if (mutationObs) return
  mutationObs = new MutationObserver((records) => {
    for (const r of records) {
      if (isInOverlay(r.target)) continue
      scheduleScan()
      return
    }
  })
  mutationObs.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "hidden", "disabled", "aria-hidden", "aria-expanded", "role", "tabindex"],
  })

  resizeObs = new ResizeObserver(() => scheduleScan())
  observed = new Set()
  syncResizeObs()

  window.addEventListener("scroll", onScroll, { capture: true, passive: true })
  window.addEventListener("resize", onResize, { passive: true })
  document.addEventListener("pointerover", onPointerOver, { passive: true })
  document.addEventListener("focusin", onFocusIn, true)
  document.addEventListener("fullscreenchange", onFullscreen)
}

function detach(): void {
  mutationObs?.disconnect()
  mutationObs = null
  resizeObs?.disconnect()
  resizeObs = null
  observed = new Set()
  window.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions)
  window.removeEventListener("resize", onResize)
  document.removeEventListener("pointerover", onPointerOver)
  document.removeEventListener("focusin", onFocusIn, true)
  document.removeEventListener("fullscreenchange", onFullscreen)
}

function onScroll(): void {
  needPos = true
}

function onResize(): void {
  needPos = true
  scheduleScan(0)
}

function onPointerOver(): void {
  const now = performance.now()
  if (now - lastPointer < 250) return
  lastPointer = now
  scheduleScan(POINTER_SCAN_MS)
}

function onFocusIn(): void {
  scheduleScan(80)
}

function onFullscreen(): void {
  view?.reparent()
  needPos = true
  scheduleScan(0)
}

function loop(): void {
  raf = requestAnimationFrame(loop)
  if (!enabled) return
  const now = performance.now()
  if (now - lastRoute >= ROUTE_CHECK_MS) {
    lastRoute = now
    if (routeChanged()) scheduleScan(0)
  }
  if (needScanAt && now >= needScanAt) {
    needScanAt = 0
    scanNow(true)
  }
  // 持续 20fps 对齐：modal 入场动画/条件渲染不一定触发 scroll。
  needPos = true
  if (needPos && now - lastPos >= POS_INTERVAL_MS) {
    lastPos = now
    needPos = false
    view?.reposition()
  }
}

function startLoop(): void {
  if (!raf) raf = requestAnimationFrame(loop)
}

function stopLoop(): void {
  if (raf) cancelAnimationFrame(raf)
  raf = 0
}

function show(): void {
  if (!view) return
  enabled = true
  config.on = true
  saveConfig()
  view.show()
  view.setExtraSelector(config.extraSelector)
  view.setBlocksOnly(config.blocksOnly)
  view.setHotkey(formatHotkey(hk))
  attach()
  view.setHint("")
  // 只在隐藏期间路由真的变了时重置；单纯隐藏/显示保持编号。
  routeChanged()
  scanNow(true)
  startLoop()
}

function hide(): void {
  enabled = false
  config.on = false
  saveConfig()
  detach()
  stopLoop()
  view?.hide()
}

function toggle(): void {
  if (enabled) hide()
  else show()
}

function onKey(e: KeyboardEvent): void {
  if (e.defaultPrevented || e.repeat || isImeComposing(e)) return
  if (!matchHotkey(e, hk)) return
  e.preventDefault()
  e.stopPropagation()
  toggle()
}

function snapshotJson(pretty: boolean): string {
  const snap = {
    url: location.pathname + location.search,
    viewport: [window.innerWidth, window.innerHeight],
    count: entries.length,
    blocks: entries.reduce((n, e) => n + (e.block ? 1 : 0), 0),
    mode: config.blocksOnly ? "blocks" : "all",
    overflow,
    items: entries.map(toJsonItem),
  }
  return JSON.stringify(snap, null, pretty ? 2 : 0)
}

const api: UiOverlayApi = {
  show,
  hide,
  toggle,
  isOn: () => enabled,
  list(): PublicEntry[] {
    ensureFresh()
    return entries.map(toPublicEntry)
  },
  json(pretty = false): string {
    ensureFresh()
    return snapshotJson(pretty)
  },
  async copy(mode: "json" | "text" = "json"): Promise<void> {
    ensureFresh()
    await copyText(mode === "json" ? snapshotJson(true) : formatText(entries))
  },
  reveal(n: number): void {
    ensureFresh()
    const entry = entries.find((e) => e.n === n)
    if (!entry) return
    entry.el.scrollIntoView({ block: "center", behavior: "auto" })
    needPos = true
    window.setTimeout(() => view?.flash(entry), 30)
  },
  setExtraSelector(sel: string): void {
    const s = sel.trim()
    if (s) {
      try {
        document.querySelectorAll(s)
      } catch {
        view?.setHint("选择器无效", true)
        return
      }
    }
    config.extraSelector = s
    saveConfig()
    view?.setExtraSelector(s)
    view?.setHint("")
    if (enabled) scanNow(true)
  },
  setHotkey(spec: string): void {
    hk = parseHotkey(spec)
    config.hotkey = formatHotkey(hk)
    saveConfig()
    view?.setHotkey(config.hotkey)
  },
  setBlocksOnly(on: boolean): void {
    config.blocksOnly = on
    saveConfig()
    view?.setBlocksOnly(on)
    if (enabled) scanNow(true)
  },
  reset(): void {
    registry.reset()
    if (enabled) scanNow(true)
    else {
      entries = []
      stats = { ...stats, candidates: 0, blocks: 0, labels: 0, overflow: 0, keys: 0, maxN: 0 }
    }
  },
  stats(): OverlayStats {
    return { ...stats, keys: registry.size(), maxN: registry.max() }
  },
}

/** 安装（由 main.tsx 的 DEV 分支动态 import 调用）。幂等。 */
export function installUiOverlay(): void {
  if (!import.meta.env.DEV || installed || window.__uiOverlay) return
  installed = true
  config = loadConfig()
  hk = parseHotkey(config.hotkey)
  view = new OverlayView({
    onCopy: (mode) => {
      void api.copy(mode)
    },
    onClose: hide,
    onApplySelector: (sel) => api.setExtraSelector(sel),
    onReveal: (n) => api.reveal(n),
    onReset: () => api.reset(),
    onToggleBlocks: () => api.setBlocksOnly(!config.blocksOnly),
  })
  view.setHotkey(formatHotkey(hk))
  view.setExtraSelector(config.extraSelector)
  view.setBlocksOnly(config.blocksOnly)
  window.addEventListener("keydown", onKey, true)
  window.__uiOverlay = api
  if (config.on) show()
  import.meta.hot?.dispose(() => uninstall())
}

/** 仅用于 HMR / 手动卸载；不写 config.on（避免把用户的开关状态改成 off）。 */
function uninstall(): void {
  enabled = false
  detach()
  stopLoop()
  window.removeEventListener("keydown", onKey, true)
  view?.destroy()
  view = null
  delete window.__uiOverlay
  installed = false
}
