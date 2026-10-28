/**
 * 元素稳定键 + 可读描述。
 *
 * 编号稳定性的关键：同一个 key 在路由会话内永远得到同一个编号。key 的优先级：
 *   1. `data-ui-overlay-key`（显式逃生口，业务代码可选）
 *   2. 业务 data 契约：`data-row` / `data-item` / `data-id` / `data-key` …
 *   3. React fiber 上的业务对象 id（`item.subscriptionId:id` / `sub.id` / `group.id`）
 *      —— 虚拟列表滚出再滚回来、DOM 节点重建，key 仍然一致
 *   4. 唯一 `id`
 *   5. 列表项（卡片/列表行/队列行/短视频）的标题文本
 *   6. 结构回退（控件）：祖先 landmark + tag/class/同级序号（不含会变的 aria-label）
 *
 * ⚠️ 结构回退的稳定性取决于 DOM 结构；这是没有业务 id 时的已知上限（JSON 里
 * `stable: false` 标出）。
 */
import type { Candidate } from "./types.ts"

interface ReactMeta {
  itemKey?: string
  /** item props 对应的组件宿主 DOM 根（用于区分「条目本身」与条目内的按钮）。 */
  itemEl?: Element
  comp?: string
}

interface FiberLike {
  return?: FiberLike | null
  child?: FiberLike | null
  stateNode?: unknown
  memoizedProps?: Record<string, unknown> | null
  type?: unknown
}

const ITEM_FIELDS = ["item", "sub", "subscription", "group", "channel", "s", "entry"]
const ITEM_SELECTOR =
  ".card, .social-card, .list-row, .queue-row, .palette-item, .sv-slide, .cand-row, .candidate, [data-item], [data-row], [role=listitem]"
const STATE_CLASS =
  /^(?:active|open|opened|closed|disabled|selected|current|playing|paused|hover|focus|focus-visible|show|hidden|in|out|is-|has-|animate-)/

function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim()
}

/** 取第一个非状态类名（状态类会导致 key 在播放/展开时跳变）。 */
function stableClass(el: Element): string {
  for (const c of el.classList) {
    if (STATE_CLASS.test(c)) continue
    return c.slice(0, 32)
  }
  return ""
}

/** 从组件 fiber 向下找第一个宿主 DOM 节点（HostComponent 的 stateNode）。 */
function hostRoot(start: FiberLike): Element | undefined {
  let f: FiberLike | undefined = start
  for (let guard = 0; f && guard < 24; guard++) {
    if (f.stateNode instanceof Element) return f.stateNode
    f = f.child ?? undefined
  }
  return undefined
}

/** 从 React fiber 的 props 里找业务对象 id（dev-only；失败静默回退）。 */
export function reactMeta(el: Element): ReactMeta {
  try {
    const key = Object.keys(el as unknown as Record<string, unknown>).find((k) => k.startsWith("__reactFiber$"))
    if (!key) return {}
    let f = (el as unknown as Record<string, unknown>)[key] as FiberLike | undefined
    let comp = ""
    for (let depth = 0; f && depth < 8; depth++, f = f.return ?? undefined) {
      const t = f.type
      if (!comp && typeof t === "function") {
        const name = (t as { displayName?: string; name?: string }).displayName ?? (t as { name?: string }).name
        if (name) comp = name
      }
      const p = f.memoizedProps
      if (!p) continue
      for (const field of ITEM_FIELDS) {
        const v = p[field]
        if (!v || typeof v !== "object") continue
        const obj = v as Record<string, unknown>
        const id = obj.id
        if (typeof id !== "string" && typeof id !== "number") continue
        if (String(id) === "") continue
        const sid = typeof obj.subscriptionId === "string" ? obj.subscriptionId : ""
        return { itemKey: `${field}:${sid}:${String(id)}`, comp, itemEl: hostRoot(f) }
      }
    }
    return { comp }
  } catch {
    return {}
  }
}

/** 标题/主文本（优先卡片/列表行的标题节点，避免把相对时间算进 key）。 */
function titleText(el: Element): string {
  const node = el.querySelector(
    ".card-title, .social-title, .list-title, [data-title], .cand-label, .palette-item .t-title, h1, h2, h3, h4",
  )
  return node?.textContent ? clean(node.textContent) : ""
}

export function isItemLike(el: Element): boolean {
  return (
    el.matches(ITEM_SELECTOR) ||
    !!el.querySelector(":scope > .card-title, :scope > .social-title, :scope > .list-title")
  )
}

/** 结构指纹：tag + 稳定类 + 同级同 tag/class 序号。 */
function shortSig(el: Element): string {
  const tag = el.tagName.toLowerCase()
  const cls = stableClass(el)
  let idx = 1
  for (let s = el.previousElementSibling; s; s = s.previousElementSibling) {
    if (s.tagName === el.tagName && stableClass(s) === cls) idx++
  }
  return `${tag}${cls ? "." + cls : ""}:${idx}`
}

/** 最近的稳定 landmark（id 优先；遇到浮层/侧栏/标题栏即停）。 */
function ancestorSig(el: Element): string {
  const parts: string[] = []
  let a = el.parentElement
  for (let i = 0; a && a !== document.body && i < 4; i++, a = a.parentElement) {
    if (a.id) {
      parts.push(`#${a.id}`)
      break
    }
    const c = stableClass(a)
    if (c) parts.push(`.${c}`)
    if (a.matches("[role=dialog], .modal, .rail, .titlebar, #toast-root, [data-radix-popper-content-wrapper]")) break
  }
  return parts.join(">")
}

/** 稳定键 + 是否来自可靠身份（结构回退 = false）。 */
export function stableKey(el: Element, meta: ReactMeta = reactMeta(el)): { key: string; stable: boolean } {
  const custom = el.getAttribute("data-ui-overlay-key")
  if (custom) return { key: `custom:${custom}`, stable: true }

  for (const attr of ["data-row", "data-item", "data-subscription-id", "data-room-id", "data-id", "data-key"]) {
    const v = el.getAttribute(attr)
    if (v) return { key: `${attr}:${v}`, stable: true }
  }

  if (meta.itemKey) {
    // 条目**根节点**只用 itemKey + 区域：不带同级序号，否则虚拟列表滚动时
    // 兄弟索引变化会让同一个条目换号。条目内的按钮再用 shortSig 区分。
    // 区域用于区分同一内容同时出现在「直播横滑轨 + 网格」的情况。
    const root = meta.itemEl
    const region = ancestorSig(root ?? el)
    if (root && root === el) return { key: `${meta.itemKey}|${region}`, stable: true }
    return { key: `${meta.itemKey}|${region}|${shortSig(el)}`, stable: true }
  }

  if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) {
    return { key: `id:${el.id}`, stable: true }
  }

  // 组件声明的区块：有标题的（设置卡/卡片）用标题做身份；纯容器只拿到结构键，
  // 需要跨重挂载稳定时由组件传 `data-ui-overlay-key`（overlayBlock 的第二参）。
  if (el.hasAttribute("data-ui-overlay-block")) {
    const name = el.getAttribute("data-ui-overlay-block") || "block"
    const text = isItemLike(el) ? titleText(el) : ""
    if (text) return { key: `block:${name}|${ancestorSig(el)}|${text.slice(0, 80)}`, stable: true }
    return { key: `block:${name}|${ancestorSig(el)}|${shortSig(el)}`, stable: false }
  }

  if (isItemLike(el)) {
    const text =
      titleText(el) || el.getAttribute("aria-label") || el.querySelector("img[alt]")?.getAttribute("alt") || ""
    if (text) {
      return {
        key: `item:${el.tagName.toLowerCase()}|${stableClass(el)}|${ancestorSig(el)}|${text.slice(0, 80)}`,
        stable: true,
      }
    }
  }

  return { key: `struct:${ancestorSig(el)}>${shortSig(el)}`, stable: false }
}

/** 人类可读的可访问名（绝不读 input.value / textarea.value）。 */
export function accessibleName(el: Element): string {
  const aria = el.getAttribute("aria-label")
  if (aria?.trim()) return clean(aria).slice(0, 60)

  const labelledby = el.getAttribute("aria-labelledby")
  if (labelledby) {
    const text = labelledby
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ")
    if (text.trim()) return clean(text).slice(0, 60)
  }

  const title = el.getAttribute("title")
  if (title?.trim()) return clean(title).slice(0, 60)

  if (el instanceof HTMLImageElement && el.alt) return clean(el.alt).slice(0, 60)

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    const labels = el.labels ? [...el.labels].map((l) => l.textContent ?? "").join(" ") : ""
    const text = labels || el.getAttribute("placeholder") || el.getAttribute("name") || ""
    return clean(text).slice(0, 60)
  }

  const t = titleText(el)
  if (t) return t.slice(0, 60)
  return clean(el.textContent ?? "").slice(0, 60)
}

function segment(el: Element): string {
  const tag = el.tagName.toLowerCase()
  if (el.id) return `${tag}#${CSS.escape(el.id)}`
  const cls = [...el.classList]
    .slice(0, 2)
    .map((c) => `.${CSS.escape(c)}`)
    .join("")
  return tag + cls
}

/**
 * 生成 CSS 选择器（用于复制给 AI/人工定位）。
 *
 * ⚠️ **不做 `querySelectorAll` 唯一性验证**：大列表里每个元素都验证会让扫描从
 * 几毫秒涨到 200ms+。路径按「同 tag/class 兄弟加 :nth-child」构造，本身已唯一；
 * 遇到 id / 业务 data-* 直接短路。极少数重复 data-idx 可用 rect/name 辅助定位。
 */
export function uniqueSelector(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`
  for (const attr of ["data-row", "data-item", "data-id", "data-key"]) {
    const v = el.getAttribute(attr)
    if (v) return `[${attr}="${CSS.escape(v)}"]`
  }

  const parts: string[] = []
  let cur: Element | null = el
  for (let i = 0; cur && cur !== document.body && i < 6; i++) {
    let seg = segment(cur)
    const parent: Element | null = cur.parentElement
    if (parent) {
      const same = [...parent.children].filter((c) => c.tagName === cur!.tagName && c.className === cur!.className)
      if (same.length > 1) seg += `:nth-child(${[...parent.children].indexOf(cur) + 1})`
    }
    parts.unshift(seg)
    if (cur.id) break
    cur = parent
  }
  return parts.join(" > ")
}

/** 除 key/rect 外的可读字段。 */
export function describeElement(
  el: Element,
  meta: ReactMeta = reactMeta(el),
): Omit<Candidate, "el" | "key" | "stable" | "rect"> {
  const tag = el.tagName.toLowerCase()
  const role = el.getAttribute("role")
  const cls = [...el.classList].slice(0, 2).join(" ")
  const type = el instanceof HTMLInputElement ? el.type : undefined
  const disabled = el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true"
  return {
    tag,
    id: el.id,
    cls,
    role,
    name: accessibleName(el),
    sel: uniqueSelector(el),
    type,
    disabled,
    comp: meta.comp,
  }
}
