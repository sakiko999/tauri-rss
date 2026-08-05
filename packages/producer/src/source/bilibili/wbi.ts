/**
 * Bilibili wbi request signing — shared by the rank source and the multi-route
 * `BilibiliSource`, ported from RSSHub `lib/routes/bilibili/cache.ts`
 * (`getWbiVerifyString`) + `utils.ts` (`addWbiVerifyInfo`).
 *
 * Key insight (verified live, 2026-08): `GET /x/web-interface/nav` returns the
 * `data.wbi_img` signing keys even when NOT logged in (`code:-101`). So no
 * cookie / puppeteer is needed — plain
 * `MD5( sortedParams & wts & mixinKey )` suffices. The mixin key is derived by
 * permuting `imgKey + subKey` through the 64-entry `MIXIN_KEY_ENC_TAB` and
 * truncating to 32 chars.
 */
import type { ProducerHost } from "../../types/producer-host.ts"
import { md5Hex } from "../../utils/md5.ts"

const API_MAIN = "https://api.bilibili.com"

// 64-entry permutation table — same one RSSHub and the live layer use.
export const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42,
  19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51,
  30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
]

export interface WbiSigner {
  /** Append `w_rid` + `wts` to the given (unsorted) query string. */
  sign(query: string): Promise<string>
}

/**
 * A wbi signer that lazily fetches & caches the mixin key on first `sign()`.
 * Each instance owns its cache (no cross-test pollution). `host` supplies
 * CORS-free HTTP; `now` may be overridden for deterministic tests.
 */
export function createWbiSigner(
  host: ProducerHost,
  now: () => number = () => host.now(),
): WbiSigner {
  let mixinKeyPromise: Promise<string> | null = null

  async function sign(query: string): Promise<string> {
    const key = await getMixinKey()
    const sp = new URLSearchParams(query)
    sp.sort()
    const wts = Math.floor(now() / 1000).toString()
    const wRid = md5Hex(`${sp.toString()}&wts=${wts}${key}`)
    return `${query}${query ? "&" : ""}w_rid=${wRid}&wts=${wts}`
  }

  async function getMixinKey(): Promise<string> {
    if (mixinKeyPromise) return mixinKeyPromise
    mixinKeyPromise = (async () => {
      const res = await host.http.request({
        url: `${API_MAIN}/x/web-interface/nav`,
        method: "GET",
        responseType: "json",
        headers: {
          "user-agent": UA,
          referer: "https://www.bilibili.com/",
        },
      })
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`Bilibili nav HTTP ${res.status}`)
      }
      const data = parseJson(res.body)
      const img = data?.data?.wbi_img
      const imgKey = fileStem(String(img?.img_url ?? ""))
      const subKey = fileStem(String(img?.sub_url ?? ""))
      if (!imgKey || !subKey) {
        throw new Error("Bilibili nav returned no wbi_img (signing unavailable)")
      }
      const origin = imgKey + subKey
      let s = ""
      for (const i of MIXIN_KEY_ENC_TAB) s += origin[i] ?? ""
      return s.slice(0, 32)
    })()
    return mixinKeyPromise
  }

  return { sign }
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

function fileStem(url: string): string {
  return url.split("/").pop()?.split(".")[0] ?? ""
}

function parseJson(body: unknown): { data?: { wbi_img?: { img_url?: unknown; sub_url?: unknown } } } {
  if (typeof body === "string") return JSON.parse(body)
  return body as { data?: { wbi_img?: { img_url?: unknown; sub_url?: unknown } } }
}