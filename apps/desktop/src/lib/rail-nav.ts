/**
 * rail-nav —— 侧栏订阅树的**按键 → 动作**映射(纯函数,无 React、无 DOM)。
 *
 * 只负责「这一下该做什么」,不负责做:DOM 查找、`focus()`、滚动都留在 Rail 里。
 * 这样这层是可断言的(见 rail-nav.check.ts),那些副作用由 CDP 巡检覆盖。
 *
 * ⚠️ 为什么不做 roving tabindex:这一节只有 10~30 个按钮,不是大列表。把行按钮
 * 移出 Tab 序之后,键盘用户就只能靠方向键走到行尾的「更多」菜单 —— 那是**退化**。
 * 方向键是**叠加的增强**,Tab 序原样保留。
 */

/** 当前焦点所在行的形态。 */
export interface RowCtx {
  kind: "group" | "ungrouped" | "member"
  /** group:该分组是否已展开。member/ungrouped 无义。 */
  expanded: boolean
  /** group:是否有子行。member/ungrouped 无义。 */
  hasChildren: boolean
}

export type NavAction =
  | { type: "move"; delta: 1 | -1 }
  | { type: "first" }
  | { type: "last" }
  /** 展开分组(不动焦点)—— 折叠时按 → 只展开,再按一次才进子项。 */
  | { type: "expand" }
  | { type: "collapse" }
  /** 焦点进第一个子行(调用方保证该分组已展开且非空)。 */
  | { type: "into" }
  /** 焦点回父行(父行保持展开)。 */
  | { type: "out" }
  /** 不消费 —— 调用方**不要** preventDefault,让事件继续冒泡。 */
  | { type: "none" }

const NONE: NavAction = { type: "none" }

/**
 * 按键 + 当前行 → 动作。
 *
 * ⚠️ `none` 的语义是「本层不管这个键」,调用方必须**不** preventDefault ——
 * 否则会吃掉全局快捷键(裸 ↑↓/j/k 是阅读视图切文章,见 lib/shortcuts.ts:52,
 * 它靠 `defaultPrevented` 守卫让内层先处理)。
 */
export function navAction(key: string, row: RowCtx): NavAction {
  if (key === "ArrowDown") return { type: "move", delta: 1 }
  if (key === "ArrowUp") return { type: "move", delta: -1 }
  if (key === "Home") return { type: "first" }
  if (key === "End") return { type: "last" }

  if (row.kind === "member") {
    // 成员行无子项:→ 不消费(让事件走);← 回父分组。
    return key === "ArrowLeft" ? { type: "out" } : NONE
  }
  if (row.kind === "ungrouped") {
    // 「未分组」是不可折叠的伪分组(它不是 Accordion.Item,没有展开态)。
    return NONE
  }
  // 分组行
  if (key === "ArrowRight") {
    if (!row.expanded) return { type: "expand" }
    return row.hasChildren ? { type: "into" } : NONE
  }
  if (key === "ArrowLeft") {
    // 已展开 → 折叠;已折叠 → 不消费(焦点该往哪走没有标准答案,交给浏览器)。
    return row.expanded ? { type: "collapse" } : NONE
  }
  return NONE
}
