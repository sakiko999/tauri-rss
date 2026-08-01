/**
 * Douyin live site — ported from
 * dart_simple_live/simple_live_live_core/lib/src/douyin_site.dart.
 *
 * Request signing: requests to `live.douyin.com/webcast/...` need an `a_bogus`
 * query param computed by the ABogus JS bundle (executed via `host.js`).
 *
 * Scope: getRecommendRooms / getRoomDetail (webRid path, Abogus-signed;
 * reflow fallback omitted for brevity), getPlayQualites / getPlayUrls (local —
 * no HTTP; reads `stream_url` from detail.data), getLiveStatus (delegates to
 * detail). Danmaku out of scope.
 */
import type { LivePlatformId } from "../../../types/media-item.ts"
import type { PlatformHost } from "../../../types/platform.ts"
import type {
  LiveCategory,
  LivePlayQuality,
  LiveRoomDetail,
  LiveRoomItem,
  LiveRoomPage,
  LiveSite,
  LiveSubCategory,
} from "../../live-site.ts"
import { type Json, arr, bodyText, strOr, toInt } from "../../shared/json.ts"
import { ABOGUS_JS } from "./abogus.ts"

const LIVE = "https://live.douyin.com"
const UA =
  "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.5845.97 Safari/537.36 Core/1.116.567.400 QQBrowser/19.7.6764.400"

/**
 * Default `ttwid` cookie — ported verbatim from dart douyin_site.dart. Douyin's
 * enter/play endpoints return an empty body (200, len 0) without a valid
 * ttwid; this long-lived one unlocks all qualities anonymously. Recommend
 * works without it, but room detail/play do not.
 */
const DEFAULT_TTWID_COOKIE =
  "ttwid=1%7CB1qls3GdnZhUov9o2NxOMxxYS2ff6OSvEWbv0ytbES4%7C1680522049%7C280d802d6d478e3e78d0c807f7c487e7ffec0ae4e5fdd6a0fe74c3c6af149511"

export class DouyinSite implements LiveSite {
  readonly platform: LivePlatformId = "douyin"
  readonly name = "抖音直播"

  /** Lazily-initialized cookie jar (fresh ttwid etc. from a warmup GET). */
  private cookieJar = ""
  private cookiePromise: Promise<void> | null = null

  constructor(private readonly host: PlatformHost) {}

  /**
   * Warmup GET to `live.douyin.com/` harvests a fresh `ttwid` (etc.) from
   * Set-Cookie. The enter/play endpoints return an empty body without it; the
   * hardcoded default ttwid in dart has expired. Memoized — one warmup per
   * instance lifetime. Mirrors dart's _getRoomDetailByWebRidHtml cookie harvest.
   */
  private ensureCookie(): Promise<void> {
    if (this.cookieJar) return Promise.resolve()
    if (!this.cookiePromise) {
      this.cookiePromise = (async () => {
        try {
          const res = await this.host.http.request({
            url: `${LIVE}/`,
            method: "GET",
            headers: { "user-agent": UA },
          })
          const sc = String(res.headers["set-cookie"] ?? "").split("\n")
          const jar = sc
            .map((c) => c.split(";")[0]!.trim())
            .filter((c) => c.includes("="))
            .join("; ")
          if (jar) this.cookieJar = jar
        } catch {
          // fall back to the stale default if warmup fails
          this.cookieJar = DEFAULT_TTWID_COOKIE
        }
      })()
    }
    return this.cookiePromise
  }

  async getCategories(): Promise<LiveCategory[]> {
    return []
  }
  async searchRooms(_keyword: string, _page?: number): Promise<LiveRoomPage> {
    return { hasMore: false, items: [] }
  }
  async searchAnchors(
    _keyword: string,
    _page?: number,
  ): Promise<{ hasMore: boolean; items: { roomId: string; avatar: string; userName: string; liveStatus: boolean }[] }> {
    return { hasMore: false, items: [] }
  }
  async getCategoryRooms(_category: LiveSubCategory, _page?: number): Promise<LiveRoomPage> {
    return { hasMore: false, items: [] }
  }

  async getRecommendRooms(page = 1): Promise<LiveRoomPage> {
    const offset = (page - 1) * 15
    const base = `${LIVE}/webcast/web/partition/detail/room/v2/`
    const params = new URLSearchParams({
      aid: "6383",
      app_name: "douyin_web",
      live_id: "1",
      device_platform: "web",
      language: "zh-CN",
      enter_from: "link_share",
      cookie_enabled: "true",
      screen_width: "1980",
      screen_height: "1080",
      browser_language: "zh-CN",
      browser_platform: "Win32",
      browser_name: "Edge",
      browser_version: "125.0.0.0",
      browser_online: "true",
      count: "15",
      offset: String(offset),
      partition: "720",
      partition_type: "1",
      req_from: "2",
    })
    const url = await this.abogusUrl(`${base}?${params.toString()}`)
    const res = await this.getJson(url)
    const list = arr(res?.data?.data)
    const items: LiveRoomItem[] = list.map((it) => ({
      roomId: String(it["web_rid"] ?? ""),
      title: String(it?.room?.title ?? ""),
      cover: String(it?.room?.cover?.url_list?.[0] ?? ""),
      userName: String(it?.room?.owner?.nickname ?? ""),
      online: toInt(it?.room?.room_view_stats?.display_value),
    }))
    return { hasMore: items.length >= 15, items }
  }

  async getRoomDetail(roomId: string): Promise<LiveRoomDetail> {
    // webRid path (short id, <= 16 chars) — the common subscription form.
    const base = `${LIVE}/webcast/room/web/enter/`
    const params = new URLSearchParams({
      aid: "6383",
      app_name: "douyin_web",
      live_id: "1",
      device_platform: "web",
      language: "zh-CN",
      browser_language: "zh-CN",
      browser_platform: "Win32",
      browser_name: "Chrome",
      browser_version: "125.0.0.0",
      web_rid: roomId,
      // msToken is appended by abogusUrl (avoid a duplicate empty msToken here).
    })
    const url = await this.abogusUrl(`${base}?${params.toString()}`)
    const res = await this.getJson(url)
    const room = res?.data?.data?.[0]?.room ?? res?.data?.room ?? {}
    const user = res?.data?.data?.[0]?.user ?? res?.data?.user ?? {}
    const streamUrl = (room["stream_url"] ?? {}) as Json
    const status = toInt(room["status"]) === 2

    return {
      roomId: String(room["id_str"] ?? roomId),
      title: String(room["title"] ?? ""),
      cover: String(streamUrl?.default?.["push_hd"]?.main?.[0]?.["flv"] ?? room?.cover?.url_list?.[0] ?? ""),
      userName: String(user["nickname"] ?? ""),
      userAvatar: String(user?.avatar_thumb?.url_list?.[0] ?? ""),
      online: toInt(room?.room_view_stats?.display_value),
      introduction: strOr(room["intro"]),
      status,
      isRecord: false,
      url: `${LIVE}/${roomId}`,
      showTime: undefined,
      // stream_url carries the play data for getPlayQualities/Urls (local).
      data: streamUrl,
    }
  }

  async getPlayQualities(detail: LiveRoomDetail): Promise<LivePlayQuality[]> {
    const streamUrl = (detail.data ?? {}) as Json
    const liveCore = streamUrl?.live_core_sdk_data ?? {}
    const pullData = liveCore?.pull_data ?? {}
    const options = pullData?.options ?? {}
    const qualities = arr(options?.qualities)
    return qualities
      .map((q) => ({
        quality: String(q["name"] ?? ""),
        sort: toInt(q["level"]),
        data: pullUrlsForQuality(streamUrl, q),
      }))
      .sort((a, b) => (b.sort ?? 0) - (a.sort ?? 0))
  }

  async getPlayUrls(
    _detail: LiveRoomDetail,
    quality: LivePlayQuality,
  ): Promise<{ urls: string[]; headers?: Record<string, string> }> {
    return { urls: (quality.data as string[]) ?? [] }
  }

  async getLiveStatus(roomId: string): Promise<boolean> {
    const detail = await this.getRoomDetail(roomId)
    return detail.status
  }

  // ── internals ───────────────────────────────────────────────────────────

  /** Sign a URL with ABogus (appends msToken + a_bogus) via host.js. */
  private async abogusUrl(url: string): Promise<string> {
    const msToken = generateMsToken(107)
    const withMs = `${url}&msToken=${msToken}`
    const query = withMs.split("?")[1] ?? ""
    const aBogus = String(this.host.js.call(ABOGUS_JS, "getABogus", [query, UA]) ?? "")
    return `${withMs}&a_bogus=${encodeURIComponent(aBogus)}`
  }

  private async getJson(url: string): Promise<Json> {
    await this.ensureCookie()
    const res = await this.host.http.request({
      url,
      method: "GET",
      responseType: "json",
      headers: {
        "user-agent": UA,
        referer: LIVE,
        authority: "live.douyin.com",
        cookie: this.cookieJar || DEFAULT_TTWID_COOKIE,
      },
    })
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Douyin HTTP ${res.status}: ${url.slice(0, 120)}`)
    }
    const text = bodyText(res.body)
    if (!text) throw new Error(`Douyin empty body for ${url.slice(0, 80)}`)
    return JSON.parse(text) as Json
  }
}

/**
 * Pull FLV/HLS URLs for one quality from the stream_url map.
 * Mirrors dart's new-format branch: stream_data JSON → data[sdk_key].main.flv/hls.
 */
function pullUrlsForQuality(streamUrl: Json, q: Json): string[] {
  const sdkKey = String(q["sdk_key"] ?? "")
  const liveCore = streamUrl?.live_core_sdk_data ?? {}
  const pullData = liveCore?.pull_data ?? {}
  const streamDataRaw = String(pullData?.stream_data ?? "")
  if (!streamDataRaw.startsWith("{")) return []
  try {
    const streamData = JSON.parse(streamDataRaw) as Json
    const main = streamData?.data?.[sdkKey]?.main ?? {}
    const flv = main?.flv ? String(main.flv) : ""
    const hls = main?.hls ? String(main.hls) : ""
    return [flv, hls].filter(Boolean)
  } catch {
    return []
  }
}

/** Random msToken (dart: generateMsToken). Non-crypto RNG is acceptable here. */
function generateMsToken(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  let out = ""
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}
