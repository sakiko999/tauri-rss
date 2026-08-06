/**
 * host — crawler 的宿主能力访问便捷层。
 *
 * 宿主实现 + 全局 appHost 门面在 @tauri-playground/host;crawler 直接访问
 * `globalThis.appHost.http`(门面 getter 校验未注入抛清晰错误)。本模块只保留
 * 便捷 GET 封装(httpText/httpJson)与时钟。
 */

/** 便捷 GET:text 响应。 */
export async function httpText(url: string, headers?: Record<string, string>): Promise<string> {
  const res = await globalThis.appHost.http.request({ url, method: "GET", responseType: "text", headers })
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}: ${url}`)
  return typeof res.body === "string" ? res.body : String(res.body)
}

/** 便捷 GET:json 响应。 */
export async function httpJson<T = unknown>(url: string, headers?: Record<string, string>): Promise<T> {
  const res = await globalThis.appHost.http.request({ url, method: "GET", responseType: "json", headers })
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}: ${url}`)
  return res.body as T
}

/** 当前 epoch ms。门面 now getter 保证返回(未注入兜底 Date.now)。 */
export function now(): number {
  return globalThis.appHost.now!()
}
