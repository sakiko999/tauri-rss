/** format — 错误对象 → 可读文本。 */

/**
 * 兼容三类:Error 实例、hls.js 的 ErrorData(`{type,details}` 普通对象)、
 * dash.js 的 `{message}` 对象。String(对象) 会退化成 `[object Object]`,必须显式提取。
 */
export function formatError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === "object") {
    const o = err as Record<string, unknown>
    const parts = [o.message, o.type, o.details].filter((v) => v != null).map(String)
    if (parts.length) return parts.join(" ")
  }
  return String(err)
}
