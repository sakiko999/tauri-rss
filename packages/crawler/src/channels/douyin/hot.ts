/**
 * douyin 直播热门 —— partition/detail/room/v2 + ABogus,支持分页加载更多。
 *
 * 复刻 dart getRecommendRooms(douyin_site.dart):`partition=720`(综合),
 * 需 ABogus 签名(复用 abogus.ts)+ ttwid cookie。`data.data[]` → {web_rid, room.title,
 * room.cover.url_list[0], room.owner.nickname, room.room_view_stats.display_value}。
 * 分页:**offset 游标制**(每页 COUNT 条,offset 递增),`isPageable` 探测 → fetchMore
 * 翻页(本页为空 = 没有更多)。
 */
import type { Item, Live } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { DanmakuPlayable, LivePlayable, Pageable, RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch, apiFetchMore, liveHotSource } from "../factory.ts"
import { now } from "../../host.ts"
import { douyinClient } from "../../platform/douyin"
import { DouyinLiveChannel } from "./live.ts"

const LIVE = "https://live.douyin.com"
const COUNT = 15

export class DouyinLiveHotChannel implements RssChannel {
  readonly key = "live:douyin:hot"
  readonly name = "抖音直播热门"
  readonly kind = "live" as const
  readonly defaultInfo = {}
  /** 内部持同平台 live channel,委托其懒解析/弹幕能力(对外 channel 身份仍是 hot)。 */
  getSource(info: SourceInfo): RssSource & LivePlayable & DanmakuPlayable & Pageable {
    return liveHotSource(new DouyinLiveChannel().getSource(info), {
      fetch: apiFetch(() => this.fetchItems(info, 0), () => this.channelOptions(info)),
      // offset 游标(首页 fetch 用 offset=0,翻页每页 COUNT 条递增;本页为空即止)。
      fetchMore: apiFetchMore(
        (offset) => this.fetchItems(info, offset),
        () => this.channelOptions(info),
        { first: COUNT, step: COUNT },
      ),
    })
  }

  private async fetchItems(_info: SourceInfo, offset: number): Promise<Item[]> {
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
      count: String(COUNT),
      offset: String(offset),
      partition: "720",
      partition_type: "1",
      req_from: "2",
    })
    // 统一走 douyinClient.getJson(内部 ABogus 签名 + warmup ttwid + status_code 校验)。
    const res = await douyinClient.getJson<{ data?: { data?: Array<Record<string, any>> } }>(
      `${base}?${params.toString()}`,
      { referer: LIVE },
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
