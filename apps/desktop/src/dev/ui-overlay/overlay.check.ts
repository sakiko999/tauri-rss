/**
 * Numbered UI Overlay 纯逻辑自检（无 DOM）。
 * 跑：bun apps/desktop/src/dev/ui-overlay/overlay.check.ts
 */

import { DEFAULT_HOTKEY, formatHotkey, matchHotkey, parseHotkey } from "./hotkey.ts"
import { selectLabels } from "./labels.ts"
import { chooseLabelPosition } from "./layout.ts"
import { NumberRegistry } from "./registry.ts"

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`ok  ${msg}`)
}
const eq = (a: unknown, b: unknown, msg: string) => assert(JSON.stringify(a) === JSON.stringify(b), msg)

// ── 快捷键 ────────────────────────────────────────────────────────────────
const def = parseHotkey(DEFAULT_HOTKEY)
assert(def.ctrl && def.shift && !def.alt && !def.meta && def.code === "KeyU", "默认 Ctrl+Shift+U 解析")
eq(formatHotkey(def), "Ctrl+Shift+U", "快捷键格式化")
const ev = (patch: Partial<KeyboardEvent> = {}) => ({
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  code: "KeyU",
  key: "u",
  ...patch,
})
assert(matchHotkey(ev({ ctrlKey: true, shiftKey: true, key: "U" }), def), "精确匹配 Ctrl+Shift+U")
assert(!matchHotkey(ev({ ctrlKey: true }), def), "缺 Shift 不命中")
assert(!matchHotkey(ev({ ctrlKey: true, shiftKey: true, altKey: true }), def), "多按 Alt 不命中")
const alt = parseHotkey("Ctrl+Alt+KeyY")
eq(alt.code, "KeyY", "解析 Ctrl+Alt+KeyY")
assert(!matchHotkey(ev({ ctrlKey: true, shiftKey: true }), alt), "不同快捷键不串")

// ── 编号注册表 ─────────────────────────────────────────────────────────────
const reg = new NumberRegistry()
eq(reg.numberFor("item:a"), 1, "首个 key → 1")
eq(reg.numberFor("item:b"), 2, "第二个 key → 2")
eq(reg.numberFor("item:a"), 1, "重复 key 复用 1（固定）")
eq(reg.size(), 2, "注册表大小")
reg.reset()
eq(reg.numberFor("item:a"), 1, "reset 后从 1 开始")
eq(reg.numberFor("item:c"), 2, "reset 后继续分配")

// ── 标签定位 ───────────────────────────────────────────────────────────────
const vp = { w: 800, h: 600 }
const big = { x: 100, y: 100, w: 200, h: 40 }
const small = { x: 100, y: 100, w: 20, h: 20 }
const label = { w: 18, h: 16 }

eq(chooseLabelPosition(big, label, vp), { x: 102, y: 102 }, "大元素优先左上内侧")
eq(chooseLabelPosition(small, label, vp), { x: 123, y: 100 }, "小元素优先右上外侧")
eq(
  chooseLabelPosition(big, label, vp, [{ x: 102, y: 102, w: 18, h: 16 }]),
  { x: 280, y: 102 },
  "避开已占用标签（翻到右上内侧）",
)
const edge = chooseLabelPosition({ x: 790, y: 590, w: 20, h: 20 }, label, vp)
assert(edge.x >= 0 && edge.x <= vp.w - label.w && edge.y >= 0 && edge.y <= vp.h - label.h, "边缘标签 clamp 在视口内")

// ── 标签选择（区块优先 / 仅区块）────────────────────────────────────────────
const e = (n: number, y: number, block = false) => ({ n, block, rect: { x: 0, y, w: 10, h: 10 } })
const five = [e(1, 10), e(2, 20, true), e(3, 30), e(4, 40, true), e(5, 50)]

const all = selectLabels(five, false, 3)
eq(
  all.shown.map((x) => x.n),
  [1, 2, 4],
  "400 上限内区块优先，shown 按视觉顺序",
)
eq(all.overflow, 2, "全部模式 overflow 计数")

const only = selectLabels(five, true, 3)
eq(
  only.shown.map((x) => x.n),
  [2, 4],
  "仅区块模式只留 block",
)
eq(only.overflow, 0, "仅区块模式不把控件算进 overflow")

const tight = selectLabels(five, true, 1)
eq(
  tight.shown.map((x) => x.n),
  [2],
  "仅区块也受标签上限约束",
)
eq(tight.overflow, 1, "仅区块超出上限时 overflow 计数")

eq(selectLabels(five, false, 0).shown, [], "limit=0 不渲染标签")
