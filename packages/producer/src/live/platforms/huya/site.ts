/**
 * Huya live site — HTTP-only port of
 * dart_simple_live/simple_live_core/lib/src/huya_site.dart.
 *
 * Scope this phase: getRecommendRooms (`/cache.php`), getRoomDetail +
 * getLiveStatus (scrape `m.huya.com/$roomId`, extract `window.HNF_GLOBAL_INIT`).
 *
 * `getPlayQualities` / `getPlayUrls` throw `NotImplementedError` because they
 * need the Tars binary codec to call `wup.huya.com`/`getCdnTokenInfoEx` — that
 * port is deferred to a later phase.
 */
import { NotImplementedError } from "../../../errors.ts"
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

const M_HUYA = "https://m.huya.com"
const WWW_HUYA = "https://www.huya.com"
const UA_MOBILE =
  "Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36"

export class HuyaSite implements LiveSite {
  readonly platform: LivePlatformId = "huya"
  readonly name = "虎牙直播"

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
    const url = `${WWW_HUYA}/cache.php?m=LiveList&do=getLiveListByPage&tagAll=0&page=${page}`
    const res = await this.getJson(url)
    const list = arr(res?.data?.datas)
    const items: LiveRoomItem[] = list.map((it) => {
      let cover = String(it["screenshot"] ?? "")
      if (cover && !cover.includes("?")) cover += "?x-oss-process=style/w338_h190&"
      return {
        roomId: String(it["profileRoom"] ?? ""),
        title: String(it["introduction"] ?? it["roomName"] ?? ""),
        cover,
        userName: String(it["nick"] ?? ""),
        online: toInt(it["totalCount"]),
      }
    })
    const hasMore = toInt(res?.data?.page) < toInt(res?.data?.totalPage)
    return { hasMore, items }
  }

  async getRoomDetail(roomId: string): Promise<LiveRoomDetail> {
    const roomInfo = await this.fetchRoomInfo(roomId)
    const ri = roomInfo.roomInfo ?? {}
    const tLiveInfo = ri.tLiveInfo ?? {}
    const tProfileInfo = ri.tProfileInfo ?? {}

    return {
      roomId: String(tLiveInfo.lProfileRoom ?? roomId),
      title: String(tLiveInfo.sIntroduction ?? tLiveInfo.sRoomName ?? ""),
      cover: String(tLiveInfo.sScreenshot ?? ""),
      userName: String(tProfileInfo.sNick ?? ""),
      userAvatar: String(tProfileInfo.sAvatar180 ?? ""),
      online: toInt(tLiveInfo.lTotalCount),
      introduction: strOr(tLiveInfo.sIntroduction),
      status: ri.eLiveStatus === 2,
      isRecord: false,
      url: `https://www.huya.com/${roomId}`,
      showTime: undefined,
    }
  }

  async getPlayQualities(_detail: LiveRoomDetail): Promise<LivePlayQuality[]> {
    throw new NotImplementedError("Huya playUrl needs the Tars codec — deferred to a later phase")
  }
  async getPlayUrls(): Promise<{ urls: string[]; headers?: Record<string, string> }> {
    throw new NotImplementedError("Huya playUrl needs the Tars codec — deferred to a later phase")
  }

  async getLiveStatus(roomId: string): Promise<boolean> {
    const roomInfo = await this.fetchRoomInfo(roomId)
    return roomInfo.roomInfo?.eLiveStatus === 2
  }

  // ── HTML scrape ─────────────────────────────────────────────────────────

  /** Fetch the mobile room page and extract the `window.HNF_GLOBAL_INIT` JSON. */
  private async fetchRoomInfo(roomId: string): Promise<Json> {
    const res = await this.host.http.request({
      url: `${M_HUYA}/${roomId}`,
      method: "GET",
      responseType: "text",
      headers: { "user-agent": UA_MOBILE },
    })
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Huya HTTP ${res.status}: ${M_HUYA}/${roomId}`)
    }
    return parseHnfGlobalInit(bodyText(res.body))
  }

  private async getJson(url: string): Promise<Json> {
    const res = await this.host.http.request({
      url,
      method: "GET",
      responseType: "json",
      headers: { "user-agent": UA_MOBILE },
    })
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Huya HTTP ${res.status}: ${url}`)
    }
    return JSON.parse(bodyText(res.body)) as Json
  }
}

/**
 * Extract the `window.HNF_GLOBAL_INIT = {...}` blob from the page HTML and
 * parse it. Mirrors dart's regex + function-stubbing: it strips the assignment
 * prefix and replaces inline `function(){}` bodies so JSON.parse succeeds.
 */
function parseHnfGlobalInit(html: string): Json {
  const blockMatch = html.match(/window\.HNF_GLOBAL_INIT\s*=\s*(\{[\s\S]*?\})\s*<\/script>/)
  if (!blockMatch?.[1]) {
    throw new Error("Huya: window.HNF_GLOBAL_INIT block not found")
  }
  let raw = blockMatch[1]
  // Stub inline function bodies the page embeds in the JSON (breaks JSON.parse).
  raw = raw.replace(/function\s*\(.*?\)\s*\{[\s\S]*?\}/g, '""')
  try {
    return JSON.parse(raw) as Json
  } catch {
    // Fallback: take a best-effort substring up to the last balanced object.
    const start = raw.indexOf("{")
    const end = raw.lastIndexOf("}")
    if (start >= 0 && end > start) {
      return JSON.parse(raw.slice(start, end + 1)) as Json
    }
    throw new Error("Huya: failed to parse HNF_GLOBAL_INIT JSON")
  }
}

