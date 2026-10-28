/**
 * Overlay 视图 —— 根节点 / 标签 / 高亮 / 信息卡 / 工具栏 / 注入样式。
 *
 * 根节点直接挂 body（不要复用 #overlay-root：它 z-index:50 的 stacking context
 * 压不过 toast 60 / 启动骨架 999）。样式运行时注入，生产包不含这份 CSS。
 */
import { isImeComposing } from "../../lib/ime.ts"
import { copyText } from "./clipboard.ts"
import { formatEntry, toJsonItem } from "./format.ts"
import { chooseLabelPosition } from "./layout.ts"
import type { Box, OverlayEntry } from "./types.ts"

export interface OverlayViewCallbacks {
  onCopy(mode: "json" | "text"): void
  onClose(): void
  onApplySelector(sel: string): void
  onReveal(n: number): void
  onReset(): void
  onToggleBlocks(): void
}

const ROOT_ID = "__dev-ui-overlay"
const STYLE_ID = "__dev-ui-overlay-style"
const Z = 2147483000

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

export class OverlayView {
  readonly root: HTMLDivElement
  private readonly style: HTMLStyleElement
  private readonly highlight: HTMLDivElement
  private readonly toolbar: HTMLDivElement
  private readonly countEl: HTMLSpanElement
  private readonly overflowEl: HTMLSpanElement
  private readonly hotkeyEl: HTMLSpanElement
  private readonly hintEl: HTMLDivElement
  private readonly selectorInput: HTMLInputElement
  private readonly blocksBtn: HTMLButtonElement
  private readonly labels = new Map<number, HTMLButtonElement>()
  /** 区块边界框（与标签同生命周期，绿色描边整个 block）。 */
  private readonly boxes = new Map<number, HTMLDivElement>()
  private readonly sizes = new Map<number, { w: number; h: number }>()
  private entries: OverlayEntry[] = []
  private entryByN = new Map<number, OverlayEntry>()
  private hovered: OverlayEntry | null = null
  private pinned: OverlayEntry | null = null
  private popover: HTMLDivElement | null = null
  private popoverCleanup: (() => void) | null = null
  private flashTimer = 0
  private cb: OverlayViewCallbacks

  constructor(cb: OverlayViewCallbacks) {
    this.cb = cb
    this.style = document.createElement("style")
    this.style.id = STYLE_ID
    this.style.textContent = CSS
    document.head.appendChild(this.style)

    this.root = el("div", "uio-root")
    this.root.id = ROOT_ID
    this.root.dataset.devOverlay = ""
    this.root.setAttribute("aria-hidden", "true")
    this.root.style.display = "none"

    this.highlight = el("div", "uio-highlight")
    this.root.appendChild(this.highlight)

    this.toolbar = el("div", "uio-toolbar")
    const head = el("div", "uio-head")
    const title = el("span", "uio-title", "UI Overlay")
    this.countEl = el("span", "uio-count", "0")
    this.overflowEl = el("span", "uio-overflow", "")
    this.hotkeyEl = el("span", "uio-hotkey", "")
    head.append(title, this.countEl, this.overflowEl, this.hotkeyEl)

    const actions = el("div", "uio-row")
    const btn = (label: string, action: string) => {
      const b = el("button", "uio-btn", label)
      b.type = "button"
      b.dataset.action = action
      return b
    }
    this.blocksBtn = btn("仅区块", "blocks")
    this.blocksBtn.title = "只显示显式声明的区块标签（控件仍编号）"
    actions.append(
      btn("复制清单", "text"),
      btn("复制 JSON", "json"),
      this.blocksBtn,
      btn("重置编号", "reset"),
      btn("关闭", "close"),
    )

    const selRow = el("div", "uio-row")
    this.selectorInput = el("input", "uio-input")
    this.selectorInput.type = "text"
    this.selectorInput.placeholder = "额外选择器，如 .my-card"
    this.selectorInput.spellcheck = false
    const apply = btn("应用", "apply")
    selRow.append(this.selectorInput, apply)

    this.hintEl = el("div", "uio-hint")
    this.toolbar.append(head, actions, selRow, this.hintEl)
    this.toolbar.addEventListener("click", (e) => {
      const t = e.target as HTMLElement | null
      const action = t?.closest<HTMLElement>("[data-action]")?.dataset.action
      if (action === "text") cb.onCopy("text")
      else if (action === "json") cb.onCopy("json")
      else if (action === "reset") cb.onReset()
      else if (action === "close") cb.onClose()
      else if (action === "apply") this.applySelector()
      else if (action === "blocks") cb.onToggleBlocks()
    })
    this.selectorInput.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || isImeComposing(e)) return
      e.preventDefault()
      this.applySelector()
    })

    this.root.append(this.toolbar)
    document.body.appendChild(this.root)
  }

  show(): void {
    this.root.style.display = ""
    this.reparent()
  }

  hide(): void {
    this.closeInfo()
    this.setHover(null)
    this.root.style.display = "none"
  }

  isShown(): boolean {
    return this.root.style.display !== "none"
  }

  setHotkey(text: string): void {
    this.hotkeyEl.textContent = text
  }

  setExtraSelector(sel: string): void {
    this.selectorInput.value = sel
  }

  setBlocksOnly(on: boolean): void {
    this.blocksBtn.dataset.on = String(on)
    this.blocksBtn.setAttribute("aria-pressed", String(on))
  }

  setHint(text: string, error = false): void {
    this.hintEl.textContent = text
    this.hintEl.dataset.error = String(error)
  }

  setEntries(entries: OverlayEntry[], overflow: number): void {
    this.entries = entries
    this.entryByN = new Map(entries.map((e) => [e.n, e]))

    // 区块边界框：只给本次真正渲染的区块建框；滚出/移除的块一并清掉。
    const wantedBoxes = new Set<number>()
    for (const entry of entries) {
      if (!entry.block) continue
      wantedBoxes.add(entry.n)
      if (this.boxes.has(entry.n)) continue
      const box = el("div", "uio-block-box")
      box.dataset.n = String(entry.n)
      this.root.appendChild(box)
      this.boxes.set(entry.n, box)
    }
    for (const [n, box] of this.boxes) {
      if (wantedBoxes.has(n)) continue
      box.remove()
      this.boxes.delete(n)
    }

    for (const [n, label] of this.labels) {
      if (this.entryByN.has(n)) continue
      label.remove()
      this.labels.delete(n)
      this.sizes.delete(n)
    }

    for (const entry of entries) {
      let label = this.labels.get(entry.n)
      if (!label) {
        // ⚠️ 闭包只捕获编号，事件触发时再按 n 查当前条目：虚拟列表重挂载后
        // 同一个 n 对应的 DOM 引用会换新，捕获旧 entry 会定位/展示已脱离的节点。
        const n = entry.n
        label = el("button", "uio-label")
        label.type = "button"
        label.tabIndex = -1
        label.dataset.n = String(n)
        label.addEventListener("pointerdown", (e) => e.stopPropagation())
        label.addEventListener("mouseenter", () => {
          const cur = this.entryByN.get(n)
          if (cur) this.setHover(cur)
        })
        label.addEventListener("mouseleave", () => {
          const cur = this.entryByN.get(n)
          if (!cur || this.pinned !== cur) this.setHover(null)
        })
        label.addEventListener("click", (e) => {
          e.preventDefault()
          e.stopPropagation()
          const cur = this.entryByN.get(n)
          if (cur) this.openInfo(cur)
        })
        this.root.appendChild(label)
        this.labels.set(n, label)
      }
      const blockAttr = entry.block ? "true" : "false"
      if (label.dataset.block !== blockAttr) {
        label.dataset.block = blockAttr
        this.sizes.delete(entry.n)
      }
      const text = String(entry.n)
      if (label.textContent !== text) {
        label.textContent = text
        this.sizes.delete(entry.n)
      }
      label.title = [entry.block ? `区块:${entry.blockName || "未命名"}` : "控件", entry.name || entry.sel]
        .filter(Boolean)
        .join(" · ")
      label.style.display = ""
    }

    // 重挂载后 n 不变、但 DOM 条目对象会换新；按 n 重新绑定，信息卡保持跟随。
    if (this.hovered) {
      const next = this.entryByN.get(this.hovered.n)
      if (next) this.hovered = next
      else this.setHover(null)
    }
    if (this.pinned) {
      const next = this.entryByN.get(this.pinned.n)
      // 同 n 但 DOM 已换新（虚拟列表重挂载）：信息卡里的选择器/位置已过期，关掉重开。
      if (next && next.el === this.pinned.el) this.pinned = next
      else this.closeInfo()
    }

    this.countEl.textContent = String(entries.length)
    this.overflowEl.textContent = overflow > 0 ? `+${overflow}` : ""
    this.overflowEl.title = overflow > 0 ? `还有 ${overflow} 个可见元素因 400 标签上限未标注` : ""
    this.reposition()
  }

  /** 按当前 rect 重新定位所有标签；由滚动/动画/窗口缩放驱动。 */
  reposition(): void {
    if (!this.isShown()) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const occupied: Box[] = []
    const tr = this.toolbar.getBoundingClientRect()
    if (tr.width > 0 && tr.height > 0) {
      occupied.push({ x: tr.x, y: tr.y, w: tr.width, h: tr.height })
    }
    if (this.popover) {
      const r = this.popover.getBoundingClientRect()
      occupied.push({ x: r.x, y: r.y, w: r.width, h: r.height })
    }

    for (const entry of this.entries) {
      const label = this.labels.get(entry.n)
      const box = this.boxes.get(entry.n)
      if (!label && !box) continue
      const r = entry.el.isConnected ? entry.el.getBoundingClientRect() : null
      if (!r || r.width < 1 || r.height < 1 || r.bottom < 0 || r.right < 0 || r.top > vh || r.left > vw) {
        if (label) label.style.display = "none"
        if (box) box.style.display = "none"
        continue
      }
      // 区块边界框跟着元素实时移动（滚动 / 动画 / 视口变化）。
      if (box) {
        box.style.display = "block"
        box.style.transform = `translate3d(${Math.round(r.x)}px, ${Math.round(r.y)}px, 0)`
        box.style.width = `${Math.round(r.width)}px`
        box.style.height = `${Math.round(r.height)}px`
      }
      if (!label) continue
      label.style.display = ""
      let size = this.sizes.get(entry.n)
      if (!size || size.w <= 0 || size.h <= 0) {
        size = { w: label.offsetWidth || 18, h: label.offsetHeight || 16 }
        this.sizes.set(entry.n, size)
      }
      const target: Box = { x: r.x, y: r.y, w: r.width, h: r.height }
      const pos = chooseLabelPosition(target, size, { w: vw, h: vh }, occupied)
      label.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`
      occupied.push({ x: pos.x, y: pos.y, w: size.w, h: size.h })
      if (this.hovered === entry || this.pinned === entry) this.placeHighlight(target, entry.block)
    }
  }

  /** 滚动到元素时闪一下高亮（不点击）。 */
  flash(entry: OverlayEntry): void {
    const r = entry.el.getBoundingClientRect()
    this.placeHighlight({ x: r.x, y: r.y, w: r.width, h: r.height }, entry.block)
    window.clearTimeout(this.flashTimer)
    this.flashTimer = window.setTimeout(() => {
      if (!this.hovered && !this.pinned) this.highlight.style.display = "none"
    }, 1200)
  }

  destroy(): void {
    this.closeInfo()
    window.clearTimeout(this.flashTimer)
    this.root.remove()
    this.style.remove()
    this.labels.clear()
    this.boxes.clear()
    this.sizes.clear()
  }

  /** 全屏播放时把根节点临时挂进 fullscreen 元素（top layer 之外的节点不可见）。 */
  reparent(): void {
    const host = document.fullscreenElement ?? document.body
    if (this.root.parentElement !== host) host.appendChild(this.root)
  }

  private applySelector(): void {
    const sel = this.selectorInput.value.trim()
    if (sel) {
      try {
        document.querySelectorAll(sel)
      } catch {
        this.setHint("选择器无效", true)
        return
      }
    }
    this.setHint("")
    this.cb.onApplySelector(sel)
  }

  private setHover(entry: OverlayEntry | null): void {
    this.hovered = entry
    if (!entry) {
      if (!this.pinned) this.highlight.style.display = "none"
      return
    }
    const r = entry.el.getBoundingClientRect()
    this.placeHighlight({ x: r.x, y: r.y, w: r.width, h: r.height }, entry.block)
  }

  private placeHighlight(r: Box, block = false): void {
    this.highlight.dataset.block = block ? "true" : "false"
    this.highlight.style.display = "block"
    this.highlight.style.transform = `translate3d(${Math.round(r.x)}px, ${Math.round(r.y)}px, 0)`
    this.highlight.style.width = `${Math.round(r.w)}px`
    this.highlight.style.height = `${Math.round(r.h)}px`
  }

  private openInfo(entry: OverlayEntry): void {
    this.closeInfo()
    const pop = el("div", "uio-pop")
    pop.setAttribute("role", "dialog")
    pop.setAttribute("aria-label", `元素 ${entry.n} 信息`)

    const head = el("div", "uio-pop-head")
    const title = el("span", "uio-pop-title", `#${entry.n}  ${entry.tag}`)
    const close = el("button", "uio-btn", "关闭")
    close.type = "button"
    close.addEventListener("click", () => this.closeInfo())
    head.append(title, close)

    const rows = el("div", "uio-kvs")
    const kv = (k: string, v: string, mono = false) => {
      const row = el("div", "uio-kv")
      const kk = el("span", "uio-k", k)
      const vv = el("span", `uio-v${mono ? " uio-mono" : ""}`, v || "—")
      row.append(kk, vv)
      rows.appendChild(row)
    }
    const live = entry.el.getBoundingClientRect()
    const r = { x: live.x, y: live.y, w: live.width, h: live.height }
    kv("名称", entry.name || "(无)")
    kv("类型", entry.block ? `区块${entry.blockName ? ` (${entry.blockName})` : ""}` : "可交互控件")
    kv("role", entry.role ?? "—")
    kv("id / class", [entry.id ? `#${entry.id}` : "", entry.cls].filter(Boolean).join("  ") || "—", true)
    kv("选择器", entry.sel, true)
    kv("位置", `${Math.round(r.x)},${Math.round(r.y)}  ${Math.round(r.w)}×${Math.round(r.h)}`)
    kv("组件", entry.comp ?? "—")
    kv("编号稳定性", entry.stable ? "稳定键" : "结构回退（DOM 结构变化可能换号）")
    kv("稳定键", entry.key, true)
    if (entry.type) kv("input type", entry.type)

    const actions = el("div", "uio-pop-actions")
    const act = (label: string, fn: () => void) => {
      const b = el("button", "uio-btn", label)
      b.type = "button"
      b.addEventListener("click", fn)
      actions.appendChild(b)
    }
    act("复制信息", () => void copyText(formatEntry(entry)))
    act("复制此条 JSON", () => void copyText(JSON.stringify(toJsonItem(entry), null, 2)))
    act("打印到控制台", () => console.log("[ui-overlay]", entry.n, entry.el))
    act("定位", () => this.cb.onReveal(entry.n))
    pop.append(head, rows, actions)

    this.root.appendChild(pop)
    this.popover = pop
    this.pinned = entry
    this.placeHighlight({ x: r.x, y: r.y, w: r.w, h: r.h }, entry.block)

    // 定位：标签右侧优先，空间不足时翻到左侧/上方。
    const label = this.labels.get(entry.n)
    const lr = label?.getBoundingClientRect()
    const pw = pop.offsetWidth
    const ph = pop.offsetHeight
    let x = lr ? lr.right + 6 : 24
    let y = lr ? lr.top : 60
    if (x + pw > window.innerWidth - 8) x = lr ? lr.left - pw - 6 : window.innerWidth - pw - 24
    if (y + ph > window.innerHeight - 8) y = window.innerHeight - ph - 8
    pop.style.transform = `translate3d(${clamp(Math.round(x), 8, Math.max(8, window.innerWidth - pw - 8))}px, ${clamp(
      Math.round(y),
      8,
      Math.max(8, window.innerHeight - ph - 8),
    )}px, 0)`

    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null
      if (!t) return
      if (pop.contains(t)) return
      if (label?.contains(t)) return
      this.closeInfo()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.preventDefault()
      e.stopImmediatePropagation()
      this.closeInfo()
    }
    document.addEventListener("pointerdown", onDown, true)
    document.addEventListener("keydown", onKey, true)
    this.popoverCleanup = () => {
      document.removeEventListener("pointerdown", onDown, true)
      document.removeEventListener("keydown", onKey, true)
    }
    // 信息卡打开时保持高亮，直到关闭。
    this.setHover(entry)
  }

  private closeInfo(): void {
    this.popoverCleanup?.()
    this.popoverCleanup = null
    this.popover?.remove()
    this.popover = null
    this.pinned = null
    if (!this.hovered) this.highlight.style.display = "none"
  }
}

const CSS = `
#${ROOT_ID} {
  position: fixed;
  inset: 0;
  z-index: ${Z};
  pointer-events: none;
  font-family: var(--font-sans, ui-sans-serif, system-ui, sans-serif);
  font-size: 11px;
  line-height: 1.4;
  color: var(--text, #eee);
  text-align: left;
}
#${ROOT_ID} * { box-sizing: border-box; }
#${ROOT_ID} .uio-label {
  position: fixed;
  left: 0;
  top: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border: 0;
  border-radius: 5px;
  /* ⚠️ 必须关掉原生 button appearance：系统深色模式下 UA 会盖掉 author 的
     background/border（实测 headless Edge color-scheme:dark 时标签变成系统灰）。 */
  appearance: none;
  -webkit-appearance: none;
  background: var(--accent, #e0a24a);
  color: var(--accent-ink, #1a1208);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  box-shadow: 0 1px 3px rgba(0,0,0,.5), 0 0 0 1px rgba(0,0,0,.25);
  cursor: pointer;
  pointer-events: auto;
  user-select: none;
  will-change: transform;
  z-index: 2;
}
#${ROOT_ID} .uio-label:hover { background: var(--accent-hover, #f0b45a); }
/* 区块标签：绿色描边软底，与琥珀色控件标签区分。 */
#${ROOT_ID} .uio-label[data-block="true"] {
  height: 18px;
  padding: 0 5px;
  border: 1px solid var(--success, #5a9e6f);
  background: var(--success-soft, rgba(90,158,111,.18));
  color: var(--text, #eee);
}
#${ROOT_ID} .uio-label[data-block="true"]:hover {
  background: var(--success-soft, rgba(90,158,111,.28));
  border-color: var(--success, #5a9e6f);
}
#${ROOT_ID} .uio-btn[data-on="true"] {
  border-color: var(--success, #5a9e6f);
  background: var(--success-soft, rgba(90,158,111,.18));
}
/* 区块边界框：绿色描边整个 block（不是只给标签上色）。 */
#${ROOT_ID} .uio-block-box {
  position: fixed;
  left: 0;
  top: 0;
  display: none;
  border: 1px solid var(--success, #5a9e6f);
  border-radius: 4px;
  /* 外侧 1px 软光晕：深色/复杂背景上 1px 实线边界仍可辨。 */
  box-shadow: 0 0 0 1px var(--success-soft, rgba(90,158,111,.35));
  background: transparent;
  pointer-events: none;
  will-change: transform;
  z-index: 0;
}
#${ROOT_ID} .uio-highlight {
  position: fixed;
  left: 0;
  top: 0;
  display: none;
  border: 2px solid var(--accent, #e0a24a);
  border-radius: 4px;
  background: var(--accent-soft, rgba(224,162,74,.12));
  box-shadow: 0 0 0 1px var(--bg, #111);
  pointer-events: none;
  will-change: transform;
  z-index: 1;
}
#${ROOT_ID} .uio-highlight[data-block="true"] {
  border-color: var(--success, #5a9e6f);
  background: var(--success-soft, rgba(90,158,111,.10));
}
#${ROOT_ID} .uio-toolbar {
  position: fixed;
  top: calc(var(--header-h, 44px) + 8px);
  right: 12px;
  width: min(320px, calc(100vw - 24px));
  display: grid;
  gap: 6px;
  padding: 8px;
  background: var(--surface-2, #262626);
  border: 1px solid var(--border-strong, rgba(255,255,255,.16));
  border-radius: var(--r-md, 8px);
  box-shadow: var(--shadow-2, 0 8px 24px rgba(0,0,0,.45));
  pointer-events: auto;
  user-select: none;
  z-index: 3;
}
#${ROOT_ID} .uio-head { display: flex; align-items: center; gap: 6px; }
#${ROOT_ID} .uio-title { font-weight: 700; letter-spacing: .02em; }
#${ROOT_ID} .uio-count {
  min-width: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--accent, #e0a24a);
  color: var(--accent-ink, #1a1208);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 10px;
  font-weight: 700;
  text-align: center;
}
#${ROOT_ID} .uio-overflow { color: var(--warning, #d6a53a); font-family: var(--font-mono, monospace); font-size: 10px; }
#${ROOT_ID} .uio-hotkey { margin-left: auto; color: var(--text-dim, #999); font-size: 10px; }
#${ROOT_ID} .uio-row { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
#${ROOT_ID} .uio-btn {
  height: 22px;
  padding: 0 7px;
  border: 1px solid var(--border-strong, rgba(255,255,255,.16));
  border-radius: 5px;
  appearance: none;
  -webkit-appearance: none;
  background: var(--surface-3, #333);
  color: var(--text, #eee);
  font: inherit;
  font-size: 10px;
  cursor: pointer;
}
#${ROOT_ID} .uio-btn:hover { background: var(--surface-hover, #3a3a3a); }
#${ROOT_ID} .uio-input {
  flex: 1;
  min-width: 0;
  height: 22px;
  padding: 0 6px;
  border: 1px solid var(--border-strong, rgba(255,255,255,.16));
  border-radius: 5px;
  background: var(--bg, #151515);
  color: var(--text, #eee);
  font: inherit;
  font-size: 10px;
  outline: none;
}
#${ROOT_ID} .uio-input:focus { border-color: var(--accent, #e0a24a); }
#${ROOT_ID} .uio-hint { min-height: 12px; color: var(--text-dim, #999); font-size: 10px; }
#${ROOT_ID} .uio-hint[data-error="true"] { color: var(--danger, #e06c6c); }
#${ROOT_ID} .uio-pop {
  position: fixed;
  left: 0;
  top: 0;
  width: min(380px, calc(100vw - 24px));
  max-height: min(60vh, 520px);
  overflow: auto;
  display: grid;
  gap: 8px;
  padding: 10px;
  background: var(--surface-2, #262626);
  border: 1px solid var(--border-strong, rgba(255,255,255,.16));
  border-radius: var(--r-md, 8px);
  box-shadow: var(--shadow-2, 0 8px 24px rgba(0,0,0,.45));
  pointer-events: auto;
  user-select: text;
  will-change: transform;
  z-index: 4;
}
#${ROOT_ID} .uio-pop-head { display: flex; align-items: center; gap: 8px; }
#${ROOT_ID} .uio-pop-title { font-weight: 700; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#${ROOT_ID} .uio-kvs { display: grid; gap: 3px; }
#${ROOT_ID} .uio-kv { display: grid; grid-template-columns: 74px minmax(0, 1fr); gap: 6px; }
#${ROOT_ID} .uio-k { color: var(--text-dim, #999); }
#${ROOT_ID} .uio-v { color: var(--text, #eee); overflow-wrap: anywhere; }
#${ROOT_ID} .uio-mono { font-family: var(--font-mono, ui-monospace, monospace); font-size: 10px; }
#${ROOT_ID} .uio-pop-actions { display: flex; flex-wrap: wrap; gap: 4px; }
`
