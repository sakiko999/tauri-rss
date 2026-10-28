/**
 * rail-nav 自检 —— 侧栏订阅树的按键映射(无框架,本地 assert)。
 * 跑:bun apps/desktop/src/lib/rail-nav.check.ts
 */
import { navAction, type RowCtx } from "./rail-nav.ts"

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`ok  ${msg}`)
}
const eq = (a: unknown, b: unknown, msg: string) => assert(JSON.stringify(a) === JSON.stringify(b), msg)

const GROUP_OPEN: RowCtx = { kind: "group", expanded: true, hasChildren: true }
const GROUP_SHUT: RowCtx = { kind: "group", expanded: false, hasChildren: true }
const GROUP_EMPTY_SHUT: RowCtx = { kind: "group", expanded: false, hasChildren: false }
const MEMBER: RowCtx = { kind: "member", expanded: false, hasChildren: false }
const UNGROUPED: RowCtx = { kind: "ungrouped", expanded: true, hasChildren: true }

// 上下移动:三种行都一样
for (const [name, row] of [
  ["分组", GROUP_OPEN],
  ["未分组", UNGROUPED],
  ["成员", MEMBER],
] as const) {
  eq(navAction("ArrowDown", row), { type: "move", delta: 1 }, `${name}行 ↓ 下移`)
  eq(navAction("ArrowUp", row), { type: "move", delta: -1 }, `${name}行 ↑ 上移`)
  eq(navAction("Home", row), { type: "first" }, `${name}行 Home → 首行`)
  eq(navAction("End", row), { type: "last" }, `${name}行 End → 末行`)
}

// 分组行:→ 折叠态只展开(不进入),展开态才进子项
eq(navAction("ArrowRight", GROUP_SHUT), { type: "expand" }, "分组行(折叠)→ 只展开")
eq(navAction("ArrowRight", GROUP_OPEN), { type: "into" }, "分组行(展开)→ 进首个成员")
eq(navAction("ArrowRight", GROUP_EMPTY_SHUT), { type: "expand" }, "空分组(折叠)→ 展开(不进入)")
// 空分组展开后 → 无可进(hasChildren=false)→ 不消费
eq(
  navAction("ArrowRight", { kind: "group", expanded: true, hasChildren: false }),
  { type: "none" },
  "空分组(展开)→ 不消费",
)

// 分组行:← 展开则折叠,已折叠则不消费
eq(navAction("ArrowLeft", GROUP_OPEN), { type: "collapse" }, "分组行(展开)← 折叠")
eq(navAction("ArrowLeft", GROUP_SHUT), { type: "none" }, "分组行(已折叠)← 不消费")

// 成员行:→ 不消费、← 回父行
eq(navAction("ArrowRight", MEMBER), { type: "none" }, "成员行 → 不消费(无子项)")
eq(navAction("ArrowLeft", MEMBER), { type: "out" }, "成员行 ← 回父分组")

// 未分组行不可折叠:→/← 都不消费
eq(navAction("ArrowRight", UNGROUPED), { type: "none" }, "未分组行 → 不消费")
eq(navAction("ArrowLeft", UNGROUPED), { type: "none" }, "未分组行 ← 不消费(不可折叠)")

// ⚠️ 关键契约:`none` 的调用方不得 preventDefault —— 否则会吃掉全局快捷键
// (裸 ↑↓/j/k 切文章,见 lib/shortcuts.ts:52 的 defaultPrevented 守卫)。
// Enter/Space 必须原样过去,让 <button> 走原生行为。
for (const k of ["Enter", " ", "j", "k", "Escape", "Tab", "a"]) {
  eq(navAction(k, GROUP_OPEN), { type: "none" }, `「${k}」不被本层接管(交回原生/全局)`)
}

console.log("\nall checks passed")
