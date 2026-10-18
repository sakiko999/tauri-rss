/** Numbered UI Overlay —— 共享类型。 */

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** 扫描到的候选（尚未编号）。 */
export interface Candidate {
  el: Element
  /** 稳定键：同一元素/条目跨重挂载复用同一个编号。 */
  key: string
  /** 键是否来自业务 id / data-* / 唯一 id（false = 结构回退）。 */
  stable: boolean
  /** 显式声明的区块（`data-ui-overlay-block`）；否则为普通可交互控件。 */
  block?: boolean
  /** 区块类型/名称（`data-ui-overlay-block` 的值）。 */
  blockName?: string
  tag: string
  id: string
  cls: string
  role: string | null
  name: string
  sel: string
  rect: Box
  type?: string
  disabled?: boolean
  comp?: string
}

/** 编号后的条目。 */
export interface OverlayEntry extends Candidate {
  n: number
}

/** 对外的精简条目（不含 DOM 引用）。 */
export type PublicEntry = Omit<OverlayEntry, "el">

export interface OverlayStats {
  scans: number
  lastScanMs: number
  /** 当前视口内候选总数（区块 + 可交互控件）。 */
  candidates: number
  /** 当前视口内显式声明的区块数。 */
  blocks: number
  /** 实际渲染的标签数（≤ 400）。 */
  labels: number
  /** 因 400 标签上限/「仅区块」模式未渲染的数量。 */
  overflow: number
  /** 本路由会话内已分配过编号的键数。 */
  keys: number
  /** 当前最大编号（编号可能不连续，这是稳定性的代价）。 */
  maxN: number
}

export interface UiOverlayApi {
  show(): void
  hide(): void
  toggle(): void
  isOn(): boolean
  /** 当前视口元素清单（不显示标签也能取）。 */
  list(): PublicEntry[]
  /** 结构化 JSON 字符串；pretty=true 时缩进 2。 */
  json(pretty?: boolean): string
  copy(mode?: "json" | "text"): Promise<void>
  /** 滚动到编号对应元素并闪一下；不会点击。 */
  reveal(n: number): void
  setExtraSelector(sel: string): void
  setHotkey(spec: string): void
  /** 只渲染区块标签（控件仍编号，切回「全部」时编号不变）。 */
  setBlocksOnly(on: boolean): void
  /** 清空编号映射（下一次扫描从 1 重新分配）。 */
  reset(): void
  stats(): OverlayStats
}
