/**
 * douyin 直播热门 —— partition/detail/room/v2 + ABogus 一次返回 15 个开播房间。
 *
 * 复刻 dart getRecommendRooms(douyin_site.dart):`partition=720`(综合),
 * 需 ABogus 签名(复用 abogus.ts)+ ttwid cookie。`data.data[]` → {web_rid, room.title,
 * room.cover.url_list[0], room.owner.nickname, room.room_view_stats.display_value}。
 */
import type { Item, Live } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { DanmakuPlayable, LivePlayable, RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch } from "../factory.ts"
import { httpJson, now } from "../../host.ts"
import { ABOGUS_JS } from "./abogus.ts"
import { DouyinLiveChannel } from "./index.ts"

const LIVE = "https://live.douyin.com"
const UA =
  "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.5845.97 Safari/537.36 Core/1.116.567.400 QQBrowser/19.7.6764.400"
const DEFAULT_TTWID =
  "ttwid=1%7CB1qls3GdnZhUov9o2NxOMxxYS2ff6OSvEWbv0ytbES4%7C1680522049%7C280d802d6d478e3e78d0c807f7c487e7ffec0ae4e5fdd6a0fe74c3c6af149511"

function generateMsToken(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  let out = ""
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

export class DouyinLiveHotChannel implements RssChannel {
  readonly key = "live:douyin:hot"
  readonly name = "抖音直播热门"
  readonly kind = "live" as const
  readonly defaultInfo = {}
  /** 内部持同平台 live channel,委托其懒解析/弹幕能力(对外 channel 身份仍是 hot)。 */
  getSource(info: SourceInfo): RssSource & LivePlayable & DanmakuPlayable {
    const room = new DouyinLiveChannel().getSource(info)
    return {
      fetch: apiFetch(() => this.fetchItems(info), () => this.channelOptions(info)),
      resolveLivePlay: (roomId) => room.resolveLivePlay(roomId),
      getDanmaku: (roomId) => room.getDanmaku(roomId),
    }
  }

  private async fetchItems(_info: SourceInfo): Promise<Item[]> {
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
      offset: "0",
      partition: "720",
      partition_type: "1",
      req_from: "2",
    })
    const msToken = generateMsToken(107)
    const withMs = `${base}?${params.toString()}&msToken=${msToken}`
    const query = withMs.split("?")[1]!
    const aBogus = String(globalThis.appHost.js.call(ABOGUS_JS, "getABogus", [query, UA]) ?? "")
    const res = await httpJson<{ data?: { data?: Array<Record<string, any>> } }>(
      `${withMs}&a_bogus=${encodeURIComponent(aBogus)}`,
      {
        "user-agent": UA,
        referer: LIVE,
        authority: "live.douyin.com",
        cookie: DEFAULT_TTWID,
      },
    )
    const t = now()
    const list = Array.isArray(res?.data?.data) ? res.data.data : []
    return list.map((item): Live => {
      const room = (item.room ?? {}) as Record<string, any>
      const webRid = String(item.web_rid ?? "")
      const owner = (room.owner ?? {}) as Record<string, any>
      const viewStats = (room.room_view_stats ?? {}) as Record<string, any>
      const coverList = Array.isArray(room.cover?.url_list) ? (room.cover.url_list as unknown[]) : []
      return {
        id: `douyin:${webRid}`,
        sourceId: "live:douyin:hot",
        kind: "live",
        title: String(room.title ?? ""),
        url: `${LIVE}/${webRid}`,
        thumbnail: coverList[0] ? String(coverList[0]) : undefined,
        author: owner.nickname ? { name: String(owner.nickname) } : undefined,
        fetchedAt: t,
        platform: "douyin",
        roomId: webRid,
        liveStatus: "live",
        online: Number(viewStats.display_value ?? 0),
      }
    })
  }

  private channelOptions(_info: SourceInfo): SerializeOptions {
    return { channelTitle: "抖音直播热门", channelLink: LIVE }
  }
}
