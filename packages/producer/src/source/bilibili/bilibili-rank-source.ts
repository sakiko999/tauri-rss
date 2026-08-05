/**
 * BilibiliRankSource — pulls Bilibili hot-search / ranking lists as `ArticleItem`s.
 *
 * Ported from RSSHub `lib/routes/bilibili/hot-search.ts` (and the wbi signing
 * from `utils.ts` / `cache.ts`), stripped of the RSSHub runtime (config, cache,
 * got). Reimplemented against `PlatformHost.http` so it works CORS-free in
 * Tauri.
 *
 * Key insight (verified live): the `/x/web-interface/nav` endpoint returns the
 * `wbi_img` signing keys even when NOT logged in (`code: -101 账号未登录` but
 * `data.wbi_img` is still present). So no cookie / puppeteer is needed —
 * plain `MD5( sortedParams & wts & mixinKey )` suffices.
 *
 * Sources:
 *   - RSSHub bilibili/cache.ts  `getWbiVerifyString` (img/sub url → mixin key)
 *   - RSSHub bilibili/utils.ts  `addWbiVerifyInfo` (w_rid = md5(params+wts+key))
 *   - RSSHub bilibili/hot-search.ts (the square/search response shape)
 */
import type { FeedItem } from "../../types/feed-item.ts"
import type { ProducerHost } from "../../types/producer-host.ts"
import type { BilibiliRankSubscription } from "../../types/subscription.ts"
import type { SourceAdapter } from "../source-adapter.ts"
import { md5Hex } from "../../utils/md5.ts"

const API_MAIN = "https://api.bilibili.com"
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

// 64-entry permutation table — identical to the one used by
// live/platforms/bilibili/site.ts (mixinKeyEncTab) and RSSHub.
const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42,
  19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51,
  30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
]

export class BilibiliRankSource implements SourceAdapter<BilibiliRankSubscription> {
  readonly kind = "bilibili-rank" as const

  constructor() {
    this.wbiKeyPromise = null
  }

  private wbiKeyPromise: Promise<string> | null

  async fetch(subscription: BilibiliRankSubscription, host: ProducerHost): Promise<FeedItem[]> {
    // Fetch hot-search via the wbi-signed `search/square` endpoint.
    const params = await this.signParams("limit=50&platform=web", host)
    const url = `${API_MAIN}/x/web-interface/wbi/search/square?${params}`
    const res = await host.http.request({
      url,
      method: "GET",
      responseType: "json",
      headers: { "user-agent": UA, referer: "https://www.bilibili.com/" },
    })
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Bilibili rank HTTP ${res.status}: ${url}`)
    }
    const data = this.parseJson(res.body)
    const trending = data?.data?.trending
    const list: Array<Record<string, unknown>> = Array.isArray(trending?.list) ? trending.list : []
    const now = host.now()

    return list.map((item, i) => {
      const keyword = String(item.keyword ?? "")
      const link =
        String(item.link ?? item.goto ?? "") ||
        `https://search.bilibili.com/all?${new URLSearchParams({ keyword })}&from_source=webtop_search`
      return {
        id: `bili-rank-${i}-${keyword}`,
        sourceId: "bilibili-rank",
        kind: "article",
        title: keyword,
        url: link,
        summary: item["icon"] ? `<img src="${item.icon}">` : undefined,
        content: `<p>${keyword}</p>`,
        contentFormat: "html",
        author: { name: subscription.title },
        publishedAt: now,
        fetchedAt: now,
        raw: item,
      } as FeedItem
    })
  }

  // ── wbi signing (ported from RSSHub, no login required) ───────────────

  /** Fetch & cache the 32-char mixin key from the unauthenticated nav response. */
  private async getWbiKey(host: ProducerHost): Promise<string> {
    if (this.wbiKeyPromise) return this.wbiKeyPromise
    this.wbiKeyPromise = (async () => {
      const res = await host.http.request({
        url: `${API_MAIN}/x/web-interface/nav`,
        method: "GET",
        responseType: "json",
        headers: { "user-agent": UA, referer: "https://www.bilibili.com/" },
      })
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`Bilibili nav HTTP ${res.status}`)
      }
      const data = this.parseJson(res.body)
      const img = data?.data?.wbi_img
      const imgKey = this.fileStem(String(img?.img_url ?? ""))
      const subKey = this.fileStem(String(img?.sub_url ?? ""))
      if (!imgKey || !subKey) {
        throw new Error("Bilibili nav returned no wbi_img (signing unavailable)")
      }
      // mixin = permuted(imgKey + subKey), truncated to 32.
      const origin = imgKey + subKey
      let s = ""
      for (const i of MIXIN_KEY_ENC_TAB) s += origin[i] ?? ""
      return s.slice(0, 32)
    })()
    return this.wbiKeyPromise
  }

  /** Append `w_rid` + `wts` to the given param string (sorted query). */
  private async signParams(params: string, host: ProducerHost): Promise<string> {
    const key = await this.getWbiKey(host)
    const sp = new URLSearchParams(params)
    sp.sort()
    const wts = Math.floor(host.now() / 1000).toString()
    const wRid = md5Hex(`${sp.toString()}&wts=${wts}${key}`)
    return `${params}&w_rid=${wRid}&wts=${wts}`
  }

  private fileStem(url: string): string {
    return url.split("/").pop()?.split(".")[0] ?? ""
  }

  private parseJson(body: unknown): { data?: { wbi_img?: { img_url?: unknown; sub_url?: unknown }; trending?: { list?: unknown } } } {
    if (typeof body === "string") return JSON.parse(body)
    return body as { data?: { wbi_img?: { img_url?: unknown; sub_url?: unknown }; trending?: { list?: unknown } } }
  }
}
