/**
 * BilibiliClient — shared HTTP + wbi signing for every bilibili consumer
 * (`BilibiliSource` video routes, `BilibiliSite` live).
 *
 * Centralizes copies of the same wiring that used to live in
 * `wbi.ts` / `live/platforms/bilibili/site.ts`:
 * UA header, `nav` → wbi mixin key, buvid3/4 finger cookie, JSON status/code
 * checks.
 *
 * Key insight (verified live, 2026-08): `GET /x/web-interface/nav` returns
 * `data.wbi_img` signing keys even when NOT logged in (`code:-101`). So no
 * cookie / puppeteer is needed — plain `MD5( sortedParams & wts & mixinKey )`.
 *
 * **Two signing semantics are intentionally kept separate** (they differ!):
 *   - `signWeb`     — B 站 web 端语义: URLSearchParams → sort →
 *     `md5Hex(排序串&wts+mixinKey)`, output `...&w_rid&wts`. Used by the video
 *     routes and rank source (same as old `wbi.ts`).
 *   - `signLiveParams` — B 站 live 语义: record params → sort → strip `!'()*` →
 *     encodeURIComponent join → `md5Hex(query+mixinKey)`, wts participates in
 *     the sort, output has NO standalone `wts=` param. Used by the live site
 *     (same as old `site.wbiSign`).
 * Do NOT merge them into one `sign()` — each consumer's API requires its own.
 */
import type { ProducerHost } from "../../types/producer-host.ts"
import { md5Hex } from "../../utils/md5.ts"
import { strOr } from "../../utils/json.ts"

export const BILIBILI_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

const API_MAIN = "https://api.bilibili.com"

// 64-entry permutation table — same one RSSHub, the rank source and the live
// layer all used (each kept its own copy before the client was extracted).
export const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42,
  19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51,
  30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
]

export interface BilibiliClientOptions {
  host: ProducerHost
  /** Referer header on every request (default `https://www.bilibili.com/`). */
  referer?: string
  /** Lazily fetch buvid3/4 from finger/spi and attach as a cookie (live needs it). */
  buvid?: boolean
  /** Enable the live signing semantics (`signLiveParams`); throws when off. */
  live?: boolean
  /** Clock override for deterministic signing in tests (defaults to `host.now`). */
  now?: () => number
}

export interface GetJsonOptions {
  /** When true, a non-zero `code` does NOT throw (caller interprets it). */
  allowCodeError?: boolean
}

export interface BilibiliClient {
  readonly host: ProducerHost
  /** GET JSON with unified UA/status/code checks; buvid cookie attached if enabled. */
  getJson(url: string, headers?: Record<string, string>, opts?: GetJsonOptions): Promise<Record<string, any>>
  /** B 站 web 语义签名: `...&w_rid&wts`. */
  signWeb(query: string): Promise<string>
  /** B 站 live 语义签名 (no standalone `wts=`; wts sorted inline). `live:true` required. */
  signLiveParams(params: Record<string, string>): Promise<string>
  /** Ensure buvid3/4 are ready (only meaningful when `buvid:true`). Idempotent. */
  ensureBuvid(): Promise<void>
}

export function createBilibiliClient(options: BilibiliClientOptions): BilibiliClient {
  const { host } = options
  const referer = options.referer ?? "https://www.bilibili.com/"
  const needBuvid = options.buvid === true
  const needLive = options.live === true
  const now = options.now ?? (() => host.now())

  // Per-instance caches (no cross-consumer pollution).
  let imgKey = ""
  let subKey = ""
  let mixinKeyPromise: Promise<string> | null = null
  let buvid3 = ""
  let buvid4 = ""
  let cookie = ""

  async function getJson(
    url: string,
    headers: Record<string, string> = {},
    opts: GetJsonOptions = {},
  ): Promise<Record<string, any>> {
    const extra: Record<string, string> = { ...headers }
    if (needBuvid) {
      await ensureBuvid()
      if (cookie) extra.cookie = cookie
    }
    const res = await host.http.request({
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
    return data
  }

  async function getMixinKey(): Promise<string> {
    if (mixinKeyPromise) return mixinKeyPromise
    mixinKeyPromise = (async () => {
      // nav is NOT routed through getJson (nav legitimately returns code:-101 when
      // logged out; we only check the HTTP status here).
      const res = await host.http.request({
        url: `${API_MAIN}/x/web-interface/nav`,
        method: "GET",
        responseType: "json",
        headers: { "user-agent": BILIBILI_UA, referer },
      })
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`bilibili nav HTTP ${res.status}`)
      }
      const data = parseJson(res.body)
      const img = data?.data?.wbi_img
      imgKey = fileStem(strOr(img?.img_url) ?? "")
      subKey = fileStem(strOr(img?.sub_url) ?? "")
      if (!imgKey || !subKey) {
        throw new Error("bilibili nav returned no wbi_img (signing unavailable)")
      }
      const origin = imgKey + subKey
      let s = ""
      for (const i of MIXIN_KEY_ENC_TAB) s += origin[i] ?? ""
      return s.slice(0, 32)
    })()
    return mixinKeyPromise
  }

  async function ensureBuvid(): Promise<void> {
    if (buvid3) return
    // Raw HTTP — NOT getJson (getJson calls ensureBuvid → infinite loop).
    const res = await host.http.request({
      url: `${API_MAIN}/x/frontend/finger/spi`,
      method: "GET",
      responseType: "json",
      headers: { "user-agent": BILIBILI_UA, referer },
    })
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`bilibili buvid HTTP ${res.status}`)
    }
    const parsed = parseJson(res.body)
    buvid3 = strOr(parsed?.data?.b_3) ?? ""
    buvid4 = strOr(parsed?.data?.b_4) ?? ""
    cookie = `buvid3=${buvid3};buvid4=${buvid4};`
  }

  async function signWeb(query: string): Promise<string> {
    const key = await getMixinKey()
    const sp = new URLSearchParams(query)
    sp.sort()
    const wts = Math.floor(now() / 1000).toString()
    const wRid = md5Hex(`${sp.toString()}&wts=${wts}${key}`)
    return `${query}${query ? "&" : ""}w_rid=${wRid}&wts=${wts}`
  }

  async function signLiveParams(params: Record<string, string>): Promise<string> {
    if (!needLive) {
      throw new Error("BilibiliClient signLiveParams requires `live: true`")
    }
    const key = await getMixinKey()
    const wts = Math.floor(now() / 1000).toString()
    const all: Record<string, string> = { ...params, wts }
    const sorted = Object.keys(all).sort()
    const filtered: Record<string, string> = {}
    for (const k of sorted) {
      filtered[k] = (all[k] ?? "").replace(/[!'()*]/g, "")
    }
    const query = sorted
      .map((k) => `${k}=${encodeURIComponent(filtered[k] ?? "")}`)
      .join("&")
    const wRid = md5Hex(`${query}${key}`)
    return `${query}&w_rid=${wRid}`
  }

  return { host, getJson, signWeb, signLiveParams, ensureBuvid }
}

function fileStem(url: string): string {
  return url.split("/").pop()?.split(".")[0] ?? ""
}

function parseJson(body: unknown): Record<string, any> {
  if (typeof body === "string") return JSON.parse(body) as Record<string, any>
  return (body ?? {}) as Record<string, any>
}
