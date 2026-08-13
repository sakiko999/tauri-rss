/**
 * number — 数字字段归一。
 *
 * 各平台 JSON 里计数/档位字段形态不定(数字 / 数字串 / `""` / 缺失),douyin/
 * douyu/weibo 曾各写一份 toInt(行为已分叉:weibo 版对空串返回 0)。统一此处。
 */

/** 安全数字化:null/undefined/空串 → undefined,其余 Number 化(非有限也 undefined)。 */
export function toInt(v: unknown): number | undefined {
  const n = Number(v)
  return Number.isFinite(n) && v !== null && v !== undefined && v !== "" ? n : undefined
}
