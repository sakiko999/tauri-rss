/**
 * Douyu live site — ported from
 * dart_simple_live/simple_live_core/lib/src/douyu_site.dart.
 *
 * Request signing: `getRoomDetail` fetches a JS blob (`swf_api/homeH5Enc`,
 * the `ub98484234` definition) and runs it through `host.js` alongside the
 * bundled CryptoJS to produce a signed body string. That signed string is
 * cached on the detail's `data` field and reused for the H5Play POSTs.
 *
 * Scope: getRecommendRooms / getRoomDetail / getPlayQualites / getPlayUrls /
 * getLiveStatus. The H5Play responses return RTMP URLs (rtmp_live), which the
 * player layer handles.
 */
import type { LivePlatformId } from "../../../types/media-item.ts"
import type { ProducerHost } from "../../../types/producer-host.ts"
import type {
  LiveCategory,
  LivePlayQuality,
  LiveRoomDetail,
  LiveRoomItem,
  LiveRoomPage,
  LiveSite,
  LiveSubCategory,
} from "../../live-site.ts"
import { type Json, arr, bodyText, strOr, toInt } from "../../../utils/json.ts"
import { CRYPTO_JS } from "./cryptojs.ts"

const BASE = "https://www.douyu.com"
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36"

export class DouyuSite implements LiveSite {
  readonly platform: LivePlatformId = "douyu"
  readonly name = "斗鱼直播"

  constructor(private readonly host: ProducerHost) {}

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
    const res = await this.getJson(`${BASE}/japi/weblist/apinc/allpage/6/${page}`)
    const list = arr(res?.data?.rl).filter((it) => toInt(it["type"]) === 1)
    const items: LiveRoomItem[] = list.map((it) => ({
      roomId: String(it["rid"] ?? ""),
      title: String(it["rn"] ?? ""),
      cover: String(it["rs16"] ?? ""),
      userName: String(it["nn"] ?? ""),
      online: toInt(it["ol"]),
    }))
    const hasMore = page < toInt(res?.data?.pgcnt)
    return { hasMore, items }
  }

  async getRoomDetail(roomId: string): Promise<LiveRoomDetail> {
    const roomInfo = await this.getRoomInfo(roomId)
    const showStatus = toInt(roomInfo["show_status"])
    const videoLoop = toInt(roomInfo["videoLoop"])

    // Fetch the sign payload (JS blob) and sign it via host.js.
    const crptext = await this.fetchSignPayload(roomId)
    const signed = this.sign(crptext, roomId)

    return {
      roomId: String(roomInfo["room_id"] ?? roomId),
      title: String(roomInfo["room_name"] ?? ""),
      cover: String(roomInfo["room_pic"] ?? ""),
      userName: String(roomInfo["owner_name"] ?? ""),
      userAvatar: String(roomInfo["owner_avatar"] ?? ""),
      online: toInt(roomInfo?.room_biz_all?.hot),
      introduction: strOr(roomInfo["show_details"]),
      status: showStatus === 1 && videoLoop !== 1,
      isRecord: videoLoop === 1,
      url: `${BASE}/${roomId}`,
      // The signed H5Play body prefix — reused by getPlayQualities/Urls.
      data: signed,
    }
  }

  async getPlayQualities(detail: LiveRoomDetail): Promise<LivePlayQuality[]> {
    const body = `${detail.data}&cdn=&rate=-1&ver=Douyu_223061205&iar=1&ive=1&hevc=0&fa=0`
    const res = await this.postH5Play(detail.roomId, body)
    const cdns = arr(res?.data?.cdnsWithName).map((c) => String(c["cdn"] ?? ""))
    cdns.sort((a, b) => Number(a.startsWith("scdn")) - Number(b.startsWith("scdn")))
    const rates = arr(res?.data?.multirates)
    return rates.map((r) => ({
      quality: String(r["name"] ?? ""),
      data: { rate: toInt(r["rate"]), cdns },
    }))
  }

  async getPlayUrls(
    detail: LiveRoomDetail,
    quality: LivePlayQuality,
  ): Promise<{ urls: string[]; headers?: Record<string, string> }> {
    const { rate, cdns } = (quality.data ?? { rate: 0, cdns: [] }) as {
      rate: number
      cdns: string[]
    }
    const urls: string[] = []
    for (const cdn of cdns) {
      const body = `${detail.data}&cdn=${cdn}&rate=${rate}`
      const res = await this.postH5Play(detail.roomId, body)
      const live = htmlUnescape(String(res?.data?.rtmp_live ?? ""))
      const rtmpUrl = String(res?.data?.rtmp_url ?? "")
      if (rtmpUrl && live) urls.push(`${rtmpUrl}/${live}`)
    }
    return { urls }
  }

  async getLiveStatus(roomId: string): Promise<boolean> {
    const roomInfo = await this.getRoomInfo(roomId)
    return toInt(roomInfo["show_status"]) === 1 && toInt(roomInfo["videoLoop"]) !== 1
  }

  // ── internals ───────────────────────────────────────────────────────────

  /** Run CryptoJS + the fetched crptext, calling ub98484234(rid, did, time). */
  private sign(crptext: string, roomId: string): string {
    const did = "10000000000000000000000000001501"
    const time = Math.floor(this.host.now() / 1000)
    const code = `${CRYPTO_JS}\n${crptext}`
    const result = this.host.js.call(code, "ub98484234", [roomId, did, time])
    return typeof result === "string" ? result : String(result ?? "")
  }

  private async fetchSignPayload(roomId: string): Promise<string> {
    const res = await this.getJson(`${BASE}/swf_api/homeH5Enc?rids=${roomId}`)
    const key = `room${roomId}`
    return String(res?.data?.[key] ?? "")
  }

  private async getRoomInfo(roomId: string): Promise<Json> {
    const res = await this.host.http.request({
      url: `${BASE}/betard/${roomId}`,
      method: "GET",
      responseType: "json",
      headers: { "user-agent": UA, referer: `${BASE}/${roomId}` },
    })
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Douyu HTTP ${res.status}: betard/${roomId}`)
    }
    const parsed = JSON.parse(bodyText(res.body))
    // betard may return a JSON string (double-encoded) or an object.
    const obj: Json = typeof parsed === "string" ? JSON.parse(parsed) : parsed
    return (obj["room"] ?? obj) as Json
  }

  private async postH5Play(roomId: string, body: string): Promise<Json> {
    const res = await this.host.http.request({
      url: `${BASE}/lapi/live/getH5Play/${roomId}`,
      method: "POST",
      body,
      responseType: "json",
      headers: {
        "user-agent": UA,
        referer: `${BASE}/${roomId}`,
        "content-type": "application/x-www-form-urlencoded",
      },
    })
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Douyu H5Play HTTP ${res.status}: ${roomId}`)
    }
    return JSON.parse(bodyText(res.body)) as Json
  }

  private async getJson(url: string): Promise<Json> {
    const res = await this.host.http.request({
      url,
      method: "GET",
      responseType: "json",
      headers: { "user-agent": UA },
    })
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Douyu HTTP ${res.status}: ${url}`)
    }
    return JSON.parse(bodyText(res.body)) as Json
  }
}

/** Decode HTML entities for the rtmp_live path (dart used HtmlUnescape). */
function htmlUnescape(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
}
