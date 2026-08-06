/**
 * BilibiliClient — crawler 版 bili 共享客户端(HTTP + wbi 签名 + buvid)。
 *
 * 复刻 producer 的 client.ts,但用 crawler 的全局 HttpBackend(不依赖 ProducerHost)。
 *
 * 两套签名语义分开(web 直播不同,不可合并):
 *   - signWeb     web 端:URLSearchParams sort → md5(串&wts+key),输出 `...&w_rid&wts`
 *   - signLive    直播端:record sort → strip `!'()*` → encode join → md5(query+key),wts 参与排序,无独立 wts
 *
 * 零登录:nav 未登录(`code:-101`)仍返回 wbi_img → MD5 即可签名。
 */
import { now } from "../../host.ts"
import { md5Hex } from "../../utils/md5.ts"

export const BILIBILI_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

const API_MAIN = "https://api.bilibili.com"

export const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42,
  19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51,
  30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
]

export interface BilibiliClientOptions {
  /** Referer header on every request(默认 https://www.bilibili.com/)。 */
  referer?: string
  /** 懒取 buvid3/4 并附 cookie(直播需要)。 */
  buvid?: boolean
  /** 启用直播签名语义(signLiveParams);关闭时调 signLiveParams 抛错。 */
  live?: boolean
  /** 测试用时钟覆盖(默认 host.now)。 */
  nowFn?: () => number
}

export interface BilibiliClient {
  /** GET JSON,统一 UA/status/code 检查;启用 buvid 时附 cookie。 */
  getJson<T = Record<string, any>>(url: string, headers?: Record<string, string>, opts?: { allowCodeError?: boolean }): Promise<T>
  /** web 签名:`...&w_rid&wts`。 */
  signWeb(query: string): Promise<string>
  /** 直播签名(无独立 wts=;wts 内联排序)。需 `live:true`。 */
  signLiveParams(params: Record<string, string>): Promise<string>
  /** 确保 buvid3/4 就绪(仅 buvid:true 有意义)。幂等。 */
  ensureBuvid(): Promise<void>
}

export function createBilibiliClient(options: BilibiliClientOptions = {}): BilibiliClient {
  const referer = options.referer ?? "https://www.bilibili.com/"
  const needBuvid = options.buvid === true
  const needLive = options.live === true
  const clock = options.nowFn ?? now

  let mixinKeyPromise: Promise<string> | null = null
  let buvid3 = ""
  let buvid4 = ""
  let cookie = ""

  async function getJson<T = Record<string, any>>(
    url: string,
    headers: Record<string, string> = {},
    opts: { allowCodeError?: boolean } = {},
  ): Promise<T> {
    const extra: Record<string, string> = { ...headers }
    if (needBuvid) {
      await ensureBuvid()
      if (cookie) extra.cookie = cookie
    }
    const res = await globalThis.appHost.http.request({
      url,
      method: "GET",
      responseType: "json",
      headers: { "user-agent": BILIBILI_UA, referer, ...extra },
    })
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`bilibili HTTP ${res.status}: ${url}`)
    }
    const data = parseJson(res.body)
    if (data?.code !== undefined && data.code !== 0 && !opts.allowCodeError) {
      throw new Error(`bilibili API ${data.code}: ${data.message ?? "unknown error"}`)
    }
    return data as T
  }

  async function getMixinKey(): Promise<string> {
    if (mixinKeyPromise) return mixinKeyPromise
    mixinKeyPromise = (async () => {
      // nav 不走 getJson(nav 合法返回 code:-101)
      const res = await globalThis.appHost.http.request({
        url: `${API_MAIN}/x/web-interface/nav`,
        method: "GET",
        responseType: "json",
        headers: { "user-agent": BILIBILI_UA, referer },
      })
      if (res.status < 200 || res.status >= 300) throw new Error(`bilibili nav HTTP ${res.status}`)
      const data = parseJson(res.body)
      const img = data?.data?.wbi_img
      const imgKey = fileStem(strOr(img?.img_url) ?? "")
      const subKey = fileStem(strOr(img?.sub_url) ?? "")
      if (!imgKey || !subKey) throw new Error("bilibili nav returned no wbi_img (signing unavailable)")
      const origin = imgKey + subKey
      let s = ""
      for (const i of MIXIN_KEY_ENC_TAB) s += origin[i] ?? ""
      return s.slice(0, 32)
    })()
    return mixinKeyPromise
  }

  async function ensureBuvid(): Promise<void> {
    if (buvid3) return
    const res = await globalThis.appHost.http.request({
      url: `${API_MAIN}/x/frontend/finger/spi`,
      method: "GET",
      responseType: "json",
      headers: { "user-agent": BILIBILI_UA, referer },
    })
    if (res.status < 200 || res.status >= 300) throw new Error(`bilibili buvid HTTP ${res.status}`)
    const parsed = parseJson(res.body)
    buvid3 = strOr(parsed?.data?.b_3) ?? ""
    buvid4 = strOr(parsed?.data?.b_4) ?? ""
    cookie = `buvid3=${buvid3};buvid4=${buvid4};`
  }

  async function signWeb(query: string): Promise<string> {
    const key = await getMixinKey()
    const sp = new URLSearchParams(query)
    sp.sort()
    const wts = Math.floor(clock() / 1000).toString()
    const wRid = md5Hex(`${sp.toString()}&wts=${wts}${key}`)
    return `${query}${query ? "&" : ""}w_rid=${wRid}&wts=${wts}`
  }

  async function signLiveParams(params: Record<string, string>): Promise<string> {
    if (!needLive) throw new Error("BilibiliClient signLiveParams requires `live: true`")
    const key = await getMixinKey()
    const wts = Math.floor(clock() / 1000).toString()
    const all: Record<string, string> = { ...params, wts }
    const sorted = Object.keys(all).sort()
    const filtered: Record<string, string> = {}
    for (const k of sorted) filtered[k] = (all[k] ?? "").replace(/[!'()*]/g, "")
    const query = sorted.map((k) => `${k}=${encodeURIComponent(filtered[k] ?? "")}`).join("&")
    const wRid = md5Hex(`${query}${key}`)
    return `${query}&w_rid=${wRid}`
  }

  return { getJson, signWeb, signLiveParams, ensureBuvid }
}

function fileStem(url: string): string {
  return url.split("/").pop()?.split(".")[0] ?? ""
}

function parseJson(body: unknown): Record<string, any> {
  if (typeof body === "string") return JSON.parse(body) as Record<string, any>
  return (body ?? {}) as Record<string, any>
}

function strOr(v: unknown): string | undefined {
  return v === undefined || v === null || v === "" ? undefined : String(v)
}
