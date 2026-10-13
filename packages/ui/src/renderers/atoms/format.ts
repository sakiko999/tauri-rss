/**
 * format — 卡片共用格式化(互动数)。
 */

/** 互动数缩写:1.2w / 3.4k / 890。 */
export function fmtCount(n?: number): string {
  if (n === undefined) return ""
  if (n >= 10000) return `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}w`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}
