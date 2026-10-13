/**
 * count — 「10万+」「1.2w」「3.4k」等中文/缩写计数单位 → 数字。
 *
 * 多平台(小红书点赞、斗鱼人气)返回的是**带单位的展示串**而非数字。
 * 全仓共用一个解析器(xhs/douyu 此前各写一份,douyu 那份还丢了单位)。
 */
export function parseCount(s: unknown): number | undefined {
  if (s === undefined || s === null) return undefined
  if (typeof s === "number") return Number.isFinite(s) ? s : undefined
  const m = String(s).match(/^([\d.]+)\s*(万|w|k)?/i)
  if (!m) return undefined
  const n = parseFloat(m[1])
  if (!Number.isFinite(n)) return undefined
  const unit = (m[2] ?? "").toLowerCase()
  if (unit === "万" || unit === "w") return Math.round(n * 10000)
  if (unit === "k") return Math.round(n * 1000)
  return n
}
