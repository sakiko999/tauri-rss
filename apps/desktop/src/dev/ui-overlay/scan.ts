import { describeElement, reactMeta, stableKey } from "./key.ts"
/**
 * 可交互元素扫描。
 *
 * 只扫描**当前挂载且在视口内**的元素：虚拟列表（Virtuoso/masonic）滚出视口的
 * 条目根本不在 DOM 里，因此不会被编号；滚回来时按稳定 key 复用原编号。
 *
 * 候选来源：
 *   - 标准可交互选择器（原生控件 + ARIA role + tabindex）
 *   - React 的 onClick/onPointerDown 兜底（覆盖 Cards.tsx 的 card-play span）
 *   - 用户自定义选择器（工具栏）
 */
import type { Box, Candidate } from "./types.ts"

const BASE_SELECTOR = [
  "button",
  "a[href]",
  "input:not([type=hidden])",
  "textarea",
  "select",
  "summary",
  "[role=button]",
  "[role=link]",
  "[role=tab]",
  "[role=menuitem]",
  "[role=menuitemcheckbox]",
  "[role=menuitemradio]",
  "[role=option]",
  "[role=checkbox]",
  "[role=radio]",
  "[role=switch]",
  "[role=combobox]",
  "[role=slider]",
  "[tabindex]:not([tabindex='-1'])",
  "[contenteditable='true']",
].join(",")

/** 组件主动声明的区块（`overlayBlock()` helper）。 */
const BLOCK_SELECTOR = "[data-ui-overlay-block]"
const MAX_DOM_WALK = 12000
/** 同一 DOM 节点的事件 props 不会频繁增删；缓存避免每次扫描都 Object.keys。 */
const handlerCache = new WeakMap<Element, boolean>()

function hasReactHandler(el: Element): boolean {
  const hit = handlerCache.get(el)
  if (hit !== undefined) return hit
  let result = false
  try {
    const key = Object.keys(el as unknown as Record<string, unknown>).find((k) => k.startsWith("__reactProps$"))
    if (key) {
      const p = (el as unknown as Record<string, unknown>)[key] as Record<string, unknown> | undefined
      result = !!(p?.onClick || p?.onPointerDown || p?.onMouseDown || p?.onTouchStart || p?.onKeyDown)
    }
  } catch {
    result = false
  }
  handlerCache.set(el, result)
  return result
}

/** 祖先链上的 display/visibility/opacity 隐藏（opacity 不继承，必须逐层查）。 */
function isHidden(el: Element, cache: Map<Element, boolean>): boolean {
  let a: Element | null = el
  while (a && a !== document.documentElement) {
    let hidden = cache.get(a)
    if (hidden === undefined) {
      const cs = getComputedStyle(a)
      hidden =
        cs.display === "none" || cs.visibility === "hidden" || cs.visibility === "collapse" || Number(cs.opacity) === 0
      cache.set(a, hidden)
    }
    if (hidden) return true
    a = a.parentElement
  }
  return false
}

function isDisabled(el: Element): boolean {
  return el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true"
}

function rectOf(el: Element): Box | null {
  const r = el.getBoundingClientRect()
  if (r.width < 4 || r.height < 4) return null
  if (r.bottom < 0 || r.right < 0 || r.top > window.innerHeight || r.left > window.innerWidth) return null
  return { x: r.x, y: r.y, w: r.width, h: r.height }
}

/** 被遮罩/无关元素盖住的点击点不算可操作（弹窗打开时排除底层页面）。 */
function isOccluded(el: Element, rect: Box): boolean {
  const x = rect.x + Math.min(8, Math.max(1, rect.w / 2))
  const y = rect.y + Math.min(8, Math.max(1, rect.h / 2))
  if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return false
  // ⚠️ 用 elementsFromPoint 跳过我们自己的标签/工具栏：标签压住采样点时，
  // 不能因此把下面的元素误判为「未被遮挡」（否则 400 上限测试会把背景也算进来）。
  const hits = document.elementsFromPoint(x, y)
  const top = hits.find((h) => !h.closest("[data-dev-overlay]"))
  if (!top) return false
  return !(el.contains(top) || top.contains(el))
}

function isCandidate(el: Element, hiddenCache: Map<Element, boolean>, occlusion: boolean, block: boolean): boolean {
  if (el.closest("[data-dev-overlay], [data-ui-overlay-ignore]")) return false
  if (el.closest("[inert]")) return false
  if (el.closest('[aria-hidden="true"]')) return false
  // 区块本身不必可交互：disabled / pointer-events:none 的容器仍要标出来。
  if (!block && isDisabled(el)) return false
  if (isHidden(el, hiddenCache)) return false
  const pe = getComputedStyle(el).pointerEvents
  if (!block && pe === "none") return false
  const rect = rectOf(el)
  if (!rect) return false
  if (occlusion && isOccluded(el, rect)) return false
  return true
}

/** 是否有需要做遮挡判断的浮层（无浮层时跳过 500 次 elementsFromPoint）。 */
function hasVisibleOccluder(): boolean {
  const nodes = document.querySelectorAll(
    '.scrim, [role="dialog"], [data-radix-popper-content-wrapper], #boot-skeleton, .boot-overlay',
  )
  for (const n of nodes) {
    const cs = getComputedStyle(n)
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue
    const r = n.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) return true
  }
  return false
}

/** 扫描当前视口，返回按视觉顺序排序的候选。 */
export function scanCandidates(extraSelector: string): Candidate[] {
  const els = new Set<Element>()
  for (const el of document.querySelectorAll(BASE_SELECTOR)) els.add(el)
  // 组件主动声明的区块。
  for (const el of document.querySelectorAll(BLOCK_SELECTOR)) els.add(el)
  if (extraSelector.trim()) {
    try {
      for (const el of document.querySelectorAll(extraSelector)) els.add(el)
    } catch {
      // 无效选择器：忽略，工具栏负责提示。
    }
  }

  // React 事件兜底：覆盖无 class 的点击型 span（如 Cards.tsx 的 card-play 内层，
  // 它只有 role="presentation" + style pointer-events:auto）。避免全 DOM 双扫。
  const nodes = document.querySelectorAll("[class], [style], [role], [tabindex]")
  const limit = Math.min(nodes.length, MAX_DOM_WALK)
  for (let i = 0; i < limit; i++) {
    const el = nodes[i]!
    if (els.has(el)) continue
    if (hasReactHandler(el)) els.add(el)
  }

  const hiddenCache = new Map<Element, boolean>()
  const occlusion = hasVisibleOccluder()
  const out: Candidate[] = []
  for (const el of els) {
    const block = el.hasAttribute("data-ui-overlay-block")
    if (!isCandidate(el, hiddenCache, occlusion, block)) continue
    const rect = rectOf(el)
    if (!rect) continue
    const meta = reactMeta(el)
    const { key, stable } = stableKey(el, meta)
    out.push({
      el,
      key,
      stable,
      rect,
      ...(block ? { block: true, blockName: el.getAttribute("data-ui-overlay-block") || undefined } : {}),
      ...describeElement(el, meta),
    })
  }

  // 同一 key 同时出现多个元素（例如同一内容被渲染两次）：按 DOM 顺序加后缀。
  const seen = new Map<string, number>()
  for (const c of out) {
    const n = seen.get(c.key) ?? 0
    seen.set(c.key, n + 1)
    if (n > 0) c.key = `${c.key}#${n + 1}`
  }

  out.sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)
  return out
}
