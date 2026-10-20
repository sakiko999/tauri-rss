/**
 * youtube:live-search —— 按关键词搜**正在直播**的视频(InnerTube 直播过滤器)。
 *
 * 搜索添加的「直播间」入口消费它:`candidatesFromSearch` 取 roomId(videoId),
 * 选中后落到 `youtube:live`(参数 videoId,与手填直播 ID 同一条订阅链)。
 *
 * ⚠️ 无分页:InnerTube search 首页实测 18~20 条(LIVE badge),continuation
 * 需要额外的 ctoken 协议,暂不做——搜索添加只需要少量候选。
 * ⚠️ `liveStatus` 信任搜索过滤器给的 LIVE badge(不再逐条打 player API;
 * 预览也不需要精确在线数,`online` 取搜索结果里的 watching 数)。
 */
import type { Item } from "@amoeba/xml"
import { type SerializeOptions } from "@amoeba/xml"
import type { RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetchItems } from "../factory.ts"
import { now, searchYouTubeLive } from "@amoeba/resolve"
import { youtubeLiveHitToLive } from "./live-shelf.ts"

export class YoutubeLiveSearchChannel implements RssChannel {
  readonly key = "youtube:live-search"
  readonly name = "YouTube 直播搜索"
  readonly kind = "live" as const
  readonly sourceInfoTpl = [{ key: "keyword", label: "搜索关键词", required: true }]

  getSource(info: SourceInfo): RssSource {
    return {
      fetch: apiFetchItems(() => this.fetchItems(info), () => this.channelOptions(info)),
    }
  }

  private async fetchItems(info: SourceInfo): Promise<Item[]> {
    const kw = String(info.keyword ?? "").trim()
    if (!kw) throw new Error("youtube:live-search 需要 keyword 参数")
    const hits = await searchYouTubeLive(kw)
    const t = now()
    return hits.map((h) => youtubeLiveHitToLive("youtube:live-search", h, t))
  }

  private channelOptions(info: SourceInfo): SerializeOptions {
    return {
      channelTitle: `YouTube 直播搜索 ${info.keyword ?? ""}`,
      channelLink: "https://www.youtube.com/",
    }
  }
}
