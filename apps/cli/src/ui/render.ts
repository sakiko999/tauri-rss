/**
 * 终端渲染辅助 —— 计时/截断/两列表。picocolors 即够,不上表格库。
 * 可观测性约定(docs/cli-plan.md §四):每个探针默认给耗时,错误打完整堆栈。
 */
import pc from "picocolors"

/** ms → 人读时长(≥1s 显示秒,否则 ms)。 */
export function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`
}

/** 计时起点。 */
export function startTimer(): () => number {
  const t0 = performance.now()
  return () => performance.now() - t0
}

/** 定长截断(超长加省略号)。 */
export function trunc(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s
}

/** 成功/失败徽标行。 */
export function ok(msg: string): string {
  return `${pc.green("✔")} ${msg}`
}

export function fail(msg: string): string {
  return `${pc.red("✘")} ${msg}`
}

/** 两列对齐(label 垫宽)。 */
export function row(label: string, value: string, width = 10): string {
  return `  ${pc.dim(label.padEnd(width))}${value}`
}

/** JSON 输出(--json 全线支持;统一 2 空格缩进)。 */
export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2))
}
