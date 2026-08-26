/**
 * host — crawler 的宿主能力访问便捷层。
 *
 * 宿主实现 + 全局 appHost 门面在 @tauri-playground/host;crawler 直接访问
 * `globalThis.appHost.http`(门面 getter 校验未注入抛清晰错误)。本模块只保留
 * 便捷 GET 封装(httpText/httpJson)与时钟。
 *
 * httpGet 是最底层:text 响应,非 2xx **不**抛(返回 status + bodyText 供诊断);
 * httpText/httpJson 在其上加 2xx 校验与解析。需要原始响应的调用方(如 weibo
 * 的 wbJson 要保留非 2xx 的 body 诊断、douyu 的 betard 要判 HTML 风控)用
 * httpGet,不各自重写 request/归一。
 */

/** 底层 GET:任意状态码,body 归一为 text。非 2xx 不抛(调用方决定诊断/抛出)。 */
export async function httpGet(
  url: string,
  headers?: Record<string, string>,
): Promise<{ status: number; bodyText: string }> {
  const res = await globalThis.appHost.http.request({ url, method: "GET", responseType: "text", headers })
  return { status: res.status, bodyText: typeof res.body === "string" ? res.body : String(res.body) }
}

/** 便捷 GET:text 响应,非 2xx 抛错。 */
export async function httpText(url: string, headers?: Record<string, string>): Promise<string> {
  const res = await httpGet(url, headers)
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}: ${url}`)
  return res.bodyText
}

/**
 * 便捷 GET:json 响应。空 body(空串/风控)返回 null——「无数据」语义,调用方用
 * `== null` 判断,不做运行时 string 收窄。统一走 text + 手动 parse(原 responseType
 * "json" 三后端 parse 行为略异,此处收敛到一处)。
 */
export async function httpJson<T = unknown>(url: string, headers?: Record<string, string>): Promise<T> {
  const res = await httpGet(url, headers)
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}: ${url}`)
  const text = res.bodyText
  if (text.trim() === "") return null as unknown as T
  return JSON.parse(text) as T
}

/** 当前 epoch ms。门面 now getter 保证返回(未注入兜底 Date.now)。 */
export function now(): number {
  return globalThis.appHost.now!()
}
