/**
 * Bilibili live site — ported from
 * dart_simple_live/simple_live_core/lib/src/bilibili_site.dart.
 *
 * Wbi request signing is reimplemented natively (MD5 via Web Crypto + the
 * hardcoded 64-entry mixinKeyEncTab permutation). No JS execution needed here
 * (unlike Douyu/Douyin). Buvid3/4 fetched lazily from the finger/spi endpoint.
 *
 * Scope: getRecommendRooms / getRoomDetail / getPlayQualites / getPlayUrls /
 * getLiveStatus. (Danmaku is out of data-layer scope.)
 */
import type { FeedLivePlatformId } from "../../../types/feed-item.ts"
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
import { md5Hex } from "../../../utils/md5.ts"
import { type Json, arr, bodyText, strOr, toInt } from "../../../utils/json.ts"

const API_LIVE = "https://api.live.bilibili.com"
const API_MAIN = "https://api.bilibili.com"
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0"

// 64-entry permutation table (dart: mixinKeyEncTab)
const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42,
  19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51,
  30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
]

export class BilibiliSite implements LiveSite {
  readonly platform: FeedLivePlatformId = "bilibili"
  readonly name = "哔哩哔哩直播"

  private imgKey = ""
  private subKey = ""
  private buvid3 = ""
  private buvid4 = ""
  private cookie = ""

  constructor(private readonly host: ProducerHost) {}

  // ── required LiveSite surface ──────────────────────────────────────────

  async getCategories(): Promise<LiveCategory[]> {
    return [] // category browsing deferred to Phase 3
  }
  async searchRooms(_keyword: string, _page?: number): Promise<LiveRoomPage> {
    return { hasMore: false, items: [] }
  }
  async searchAnchors(_keyword: string, _page?: number): Promise<{ hasMore: boolean; items: { roomId: string; avatar: string; userName: string; liveStatus: boolean }[] }> {
    return { hasMore: false, items: [] }
  }
  async getCategoryRooms(_category: LiveSubCategory, _page?: number): Promise<LiveRoomPage> {
    return { hasMore: false, items: [] }
  }

  async getRecommendRooms(page = 1): Promise<LiveRoomPage> {
    const base = `${API_LIVE}/xlive/web-interface/v1/second/getListByArea`
    const params = await this.wbiSign(base, {
      platform: "web",
      sort: "online",
      page_size: "30",
      page: String(page),
    })
    const res = await this.getJson(`${base}?${params}`)
    const list = (res?.data?.list ?? []) as Json[]
    const items: LiveRoomItem[] = list.map((it) => ({
      roomId: String(it["roomid"] ?? ""),
      title: String(it["title"] ?? ""),
      cover: `${it["cover"] ?? ""}@400w.jpg`,
      userName: String(it["uname"] ?? ""),
      online: toInt(it["online"]),
    }))
    return { hasMore: items.length > 0, items }
  }

  async getRoomDetail(roomId: string): Promise<LiveRoomDetail> {
    await this.ensureBuvid()

    // Request A: room info (wbi-signed)
    const infoBase = `${API_LIVE}/xlive/web-room/v1/index/getInfoByRoom`
    const infoParams = await this.wbiSign(infoBase, { room_id: roomId })
    const info = await this.getJson(`${infoBase}?${infoParams}`)
    const roomInfo = info?.data ?? {}
    const ri = (roomInfo["room_info"] ?? {}) as Record<string, unknown>
    const realRoomId = String(ri["room_id"] ?? roomId)

    return {
      roomId: realRoomId,
      title: String(ri["title"] ?? ""),
      cover: String(ri["cover"] ?? ""),
      userName: String(ri["uname"] ?? ""),
      userAvatar: String(ri["face"] ?? ""),
      online: toInt(ri["online"]),
      introduction: strOr(ri["description"]),
      status: toInt(ri["live_status"]) === 1,
      isRecord: false,
      url: `https://live.bilibili.com/${realRoomId}`,
      showTime: strOr(ri["live_start_time"]),
      // danmaku token / server info omitted from data-layer scope
    }
  }

  async getPlayQualities(detail: LiveRoomDetail): Promise<LivePlayQuality[]> {
    const params = new URLSearchParams({
      room_id: detail.roomId,
      protocol: "0,1",
      format: "0,1,2",
      codec: "0,1",
      platform: "web",
    })
    const res = await this.getJson(`${API_LIVE}/xlive/web-room/v2/index/getRoomPlayInfo?${params}`)
    const desc = ((res?.data?.playurl_info?.playurl?.g_qn_desc) ?? []) as Record<string, unknown>[]
    const qualityMap = new Map<number, string>()
    for (const d of desc) qualityMap.set(toInt(d["qn"]), String(d["desc"] ?? ""))

    const accept = (res?.data?.playurl_info?.playurl?.stream?.[0]?.format?.[0]?.codec?.[0]
      ?.accept_qn ?? []) as number[]
    return accept.map((qn) => ({
      quality: qualityMap.get(qn) ?? "未知清晰度",
      data: qn,
    }))
  }

  async getPlayUrls(detail: LiveRoomDetail, quality: LivePlayQuality): Promise<{
    urls: string[]
    headers?: Record<string, string>
  }> {
    const params = new URLSearchParams({
      room_id: detail.roomId,
      protocol: "0,1",
      format: "0,2",
      codec: "0",
      platform: "web",
      qn: String(quality.data ?? ""),
    })
    const res = await this.getJson(`${API_LIVE}/xlive/web-room/v2/index/getRoomPlayInfo?${params}`)
    const streams = ((res?.data?.playurl_info?.playurl?.stream) ?? []) as Record<string, unknown>[]
    const urls: string[] = []
    for (const stream of streams) {
      for (const format of arr(stream["format"])) {
        for (const codec of arr(format["codec"])) {
          const baseUrl = String(codec["base_url"] ?? "")
          for (const info of arr(codec["url_info"])) {
            const host = String(info["host"] ?? "")
            const extra = String(info["extra"] ?? "")
            if (host) urls.push(`${host}${baseUrl}${extra}`)
          }
        }
      }
    }
    // mcdn entries last (dart behavior)
    urls.sort((a, b) => Number(a.includes("mcdn")) - Number(b.includes("mcdn")))
    return {
      urls,
      headers: { referer: "https://live.bilibili.com", "user-agent": UA },
    }
  }

  async getLiveStatus(roomId: string): Promise<boolean> {
    const res = await this.getJson(`${API_LIVE}/room/v1/Room/get_info?room_id=${roomId}`)
    return toInt(res?.data?.live_status) === 1
  }

  // ── Wbi signing + helpers ──────────────────────────────────────────────

  private async getWbiKeys(): Promise<[string, string]> {
    if (this.imgKey && this.subKey) return [this.imgKey, this.subKey]
    const res = await this.getJson(`${API_MAIN}/x/web-interface/nav`)
    const imgUrl = String(res?.data?.wbi_img?.img_url ?? "")
    const subUrl = String(res?.data?.wbi_img?.sub_url ?? "")
    this.imgKey = imgUrl.substring(imgUrl.lastIndexOf("/") + 1).split(".")[0] ?? ""
    this.subKey = subUrl.substring(subUrl.lastIndexOf("/") + 1).split(".")[0] ?? ""
    return [this.imgKey, this.subKey]
  }

  private getMixinKey(origin: string): string {
    let s = ""
    for (const i of MIXIN_KEY_ENC_TAB) s += origin[i] ?? ""
    return s.substring(0, 32)
  }

  /** Add wts + w_rid to the given params, return the full query string. */
  private async wbiSign(_baseUrl: string, extra: Record<string, string>): Promise<string> {
    const [imgKey, subKey] = await this.getWbiKeys()
    const mixinKey = this.getMixinKey(imgKey + subKey)
    const wts = Math.floor(this.host.now() / 1000).toString()

    const params: Record<string, string> = { ...extra, wts }
    const sorted = Object.keys(params).sort()
    const filtered: Record<string, string> = {}
    for (const k of sorted) {
      filtered[k] = (params[k] ?? "").replace(/[!'()*]/g, "")
    }
    const query = sorted
      .map((k) => `${k}=${encodeURIComponent(filtered[k] ?? "")}`)
      .join("&")
    const wRid = md5Hex(`${query}${mixinKey}`)
    return `${query}&w_rid=${wRid}`
  }

  private async ensureBuvid(): Promise<void> {
    if (this.buvid3) return
    // Fetch via raw HTTP — NOT getJson (which calls ensureBuvid → infinite loop).
    const res = await this.host.http.request({
      url: `${API_MAIN}/x/frontend/finger/spi`,
      method: "GET",
      responseType: "json",
      headers: { "user-agent": UA, referer: "https://www.bilibili.com/" },
    })
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Bilibili buvid HTTP ${res.status}`)
    }
    const parsed = JSON.parse(bodyText(res.body)) as Json
    this.buvid3 = String(parsed?.data?.["b_3"] ?? "")
    this.buvid4 = String(parsed?.data?.["b_4"] ?? "")
  }

  private async getJson(url: string): Promise<Json> {
    await this.ensureBuvid()
    const res = await this.host.http.request({
      url,
      method: "GET",
      responseType: "json",
      headers: {
        "user-agent": UA,
        referer: "https://live.bilibili.com/",
        cookie: this.cookie || `buvid3=${this.buvid3};buvid4=${this.buvid4};`,
      },
    })
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Bilibili HTTP ${res.status}: ${url}`)
    }
    return JSON.parse(bodyText(res.body)) as Json
  }
}