/**
 * xhs 时间戳单位判别自检。
 *
 * 失败模式是**静默错值**:单位判错不会抛错、不会崩,只会让内容排序永久错位
 * (实测:毫秒被当秒再 ×1000 → 公元 58754 年 → 「全部」页前 12 条全是 social,
 * 本该置顶的直播被挤到 112 位开外)。所以留断言。
 */
import { toEpochMs } from "../platform/xhs/client.ts"

let failed = 0
const ok = (cond: boolean, msg: string): void => {
  if (!cond) {
    failed += 1
    console.error(`✘ ${msg}`)
  }
}

const ISO = (ms: number | undefined): string => (ms === undefined ? "undefined" : new Date(ms).toISOString())

// ── 毫秒输入(小红书当前形态):必须原样保留 ──────────────────────────────────
ok(toEpochMs(1791961240000) === 1791961240000, `毫秒应原样保留,实得 ${toEpochMs(1791961240000)}`)
ok(ISO(toEpochMs(1791961240000))?.startsWith("2026-"), `毫秒换算后应是 2026 年,实得 ${ISO(toEpochMs(1791961240000))}`)

// ── 秒输入(旧形态):必须 ×1000 ────────────────────────────────────────────
ok(toEpochMs(1791961240) === 1791961240000, `秒应 ×1000,实得 ${toEpochMs(1791961240)}`)
ok(ISO(toEpochMs(1791961240))?.startsWith("2026-"), `秒换算后应是 2026 年,实得 ${ISO(toEpochMs(1791961240))}`)

// ── 非法输入 → undefined(宁可沉底,不要极端错值) ──────────────────────────
ok(toEpochMs(undefined) === undefined, "undefined 应返回 undefined")
ok(toEpochMs(null) === undefined, "null 应返回 undefined")
ok(toEpochMs("") === undefined, "空串应返回 undefined")
ok(toEpochMs(0) === undefined, "0 应返回 undefined")
ok(toEpochMs(-1) === undefined, "负数应返回 undefined")
ok(toEpochMs("abc") === undefined, "非数字应返回 undefined")

// ── 字符串数字也要认(平台有时给字符串) ──────────────────────────────────
ok(toEpochMs("1791961240000") === 1791961240000, "数字字符串(毫秒)应可解析")

// ── 回归守卫:放大 1000 倍那种值必须是**不可能**的产物 ─────────────────────
// 即「毫秒输入」经过本函数后,年份必须仍在合理范围(而不是 5 万年)。
const y = new Date(toEpochMs(1791961240000)!).getUTCFullYear()
ok(y === 2026, `毫秒输入换算后年份应为 2026,实得 ${y}(说明又被乘了一次 1000)`)

if (failed) {
  console.error(`✘ xhs 时间戳自检失败 ${failed} 条`)
  process.exit(1)
}
console.log("✔ xhs 时间戳自检通过(毫秒不重复放大 / 秒可识别 / 非法值沉底)")
