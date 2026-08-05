/**
 * Bilibili live site — ported from
 * dart_simple_live/simple_live_core/lib/src/bilibili_site.dart.
 *
 * Wbi signing, buvid cookie and HTTP all go through the shared
 * `BilibiliClient` (`createBilibiliClient` with `buvid:true, live:true`).
 * The client owns the live signing semantics (`signLiveParams`), the buvid3/4
 * finger cookie and the unified UA/status/code checks — the same client the
 * video `BilibiliSource` uses, so bilibili live and the bilibili source share
 * every low-level operation.
 *
 * Scope: getRecommendRooms / getRoomDetail / getPlayQualites / getPlayUrls /
 * getLiveStatus. (Danmaku is out of data-layer scope.)
 */
import type { FeedLivePlatformId } from "../../types/feed-item.ts"
import type { ProducerHost } from "../../types/producer-host.ts"
import type {
  LiveCategory,
  LivePlayQuality,
  LiveRoomDetail,
  LiveRoomItem,
  LiveRoomPage,
  LiveSite,
  LiveSubCategory,
} from "../../types/live-site.ts"
import { BILIBILI_UA, createBilibiliClient } from "./client.ts"
import { arr, toInt, strOr } from "../../utils/json.ts"

const API_LIVE = "https://api.live.bilibili.com"

export class BilibiliSite implements LiveSite {
  readonly platform: FeedLivePlatformId = "bilibili"
  readonly name = "哔哩哔哩直播"

  private readonly client: ReturnType<typeof createBilibiliClient>

  constructor(host: ProducerHost) {
    this.client = createBilibiliClient({
      host,
      referer: "https://live.bilibili.com/",
      buvid: true,
      live: true,
    })
  }

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
    const params = await this.client.signLiveParams({
      platform: "web",
      sort: "online",
      page_size: "30",
      page: String(page),
    })
    const res = await this.client.getJson(`${base}?${params}`)
    const list = (res?.data?.list ?? []) as Array<Record<string, any>>
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
    // Request A: room info (wbi-signed)
    const infoBase = `${API_LIVE}/xlive/web-room/v1/index/getInfoByRoom`
    const infoParams = await this.client.signLiveParams({ room_id: roomId })
    const info = await this.client.getJson(`${infoBase}?${infoParams}`)
    const roomInfo = (info?.data ?? {}) as Record<string, unknown>
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
    const res = await this.client.getJson(`${API_LIVE}/xlive/web-room/v2/index/getRoomPlayInfo?${params}`)
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
    const res = await this.client.getJson(`${API_LIVE}/xlive/web-room/v2/index/getRoomPlayInfo?${params}`)
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
      headers: { referer: "https://live.bilibili.com", "user-agent": BILIBILI_UA },
    }
  }

  async getLiveStatus(roomId: string): Promise<boolean> {
    // A missing/offline room returns code:1 with HTTP 200 — treat as "not live".
    const res = await this.client.getJson(
      `${API_LIVE}/room/v1/Room/get_info?room_id=${roomId}`,
      {},
      { allowCodeError: true },
    )
    return toInt(res?.data?.live_status) === 1
  }
}
