/**
 * str — 字符串字段归一。
 *
 * 各平台 JSON 里可选字符串字段形态不定(null/undefined/空串 vs 真值),
 * bili/douyin/douyu 曾各写一份 strOr(完全同实现)。统一此处。
 */

/** 空值归一:null/undefined/空串 → undefined,其余 String 化。 */
export function strOr(v: unknown): string | undefined {
  return v === undefined || v === null || v === "" ? undefined : String(v)
}
