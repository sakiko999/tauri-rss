/**
 * URL 处理工具。图床混用 http 时浏览器混载会报错(mixed content),统一升 https。
 */

/** http 协议升 https(仅改 scheme,其余原样)。 */
export function toHttps(u: string): string {
  return u.replace(/^http:\/\//, "https://")
}
