/**
 * 续播位置决策自检 —— 跑:`bun packages/core/src/reading-position.check.ts`
 *
 * 为什么单列:两个 app(desktop/mobile)的 savePosition 都依赖这两条判据,写反/阈值写成
 * 「且」都不会报错,只会表现为「看完重开跳结尾」或「SQLite 被 4Hz 写打爆」。这里钉住行为。
 */

import assert from "node:assert/strict"

import { positionDecision } from "./reading-position.ts"

const dur = 100

// 正常推进:差 ≥5s → 写。
assert.deepEqual(positionDecision(0, 30, dur), { kind: "save", next: 30 })
// 节流:差 <5s → 不写。
assert.deepEqual(positionDecision(30, 32, dur), { kind: "wait" })
assert.deepEqual(positionDecision(30, 34.9, dur), { kind: "wait" })
// 边界:恰好 5s → 写(阈值是「不足 5s 才跳过」)。
assert.deepEqual(positionDecision(30, 35, dur), { kind: "save", next: 35 })

// 近片尾(剩余 <15s)→ 清除,即使差异很大。
assert.deepEqual(positionDecision(0, 90, dur), { kind: "clear" })
// 近片尾(比例 >98%)→ 清除。
assert.deepEqual(positionDecision(0, 98.5, dur), { kind: "clear" })
// 90/100 恰好落在「剩余 10s」—— 两者都命中,仍清除。
assert.deepEqual(positionDecision(0, 99, dur), { kind: "clear" })

// 清除优先于节流(近片尾即使差 0s 也要清,不能因「变化小」而跳过清除)。
assert.deepEqual(positionDecision(99, 99, dur), { kind: "clear" })

// duration=0 不应走此函数(调用方跳过);若误传,则退化为纯节流(不误判清除)。
assert.deepEqual(positionDecision(10, 100, 0), { kind: "save", next: 100 })

console.log("✔ reading-position 自检通过(近片尾清除 / 5s 节流)")
