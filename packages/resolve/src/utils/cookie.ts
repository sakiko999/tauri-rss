/**
 * cookie — cookie 串解析(browser 复制格式 `k=v; k2=v2`)。
 *
 * 多个平台 client(bili/xhs)都要从完整 cookie 串里按 key 取值,统一在此解析。
 */

/** cookie 串 → 字典(`k=v; k2=v2` → `{ k: "v", k2: "v2" }`)。 */
export function parseCookieDict(str: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of str.split(";")) {
    const eq = part.indexOf("=")
    if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim()
  }
  return out
}

/** 从完整 cookie 串按 key 取值,不存在返回空串。 */
export function extractCookie(cookie: string, key: string): string {
  return parseCookieDict(cookie)[key] ?? ""
}

/**
 * 字典 → cookie 串(按 key 排序)。
 *
 * 只给**快照落库/比较**用:顺序稳定,才能判断「启动时浏览器 cookie 是否变化」。
 * 登录流程返回给用户的串仍用各自的原序序列化,不改成这个(避免无谓的字节变化)。
 */
export function serializeCookieDict(cookies: Record<string, string>): string {
  return Object.keys(cookies)
    .sort()
    .map((k) => `${k}=${cookies[k]}`)
    .join("; ")
}
