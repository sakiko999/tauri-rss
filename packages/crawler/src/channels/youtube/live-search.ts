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
import { makeApiChannel } from "../factory.ts"
import { now, searchYouTubeLive } from "@amoeba/resolve"
import { youtubeLiveHitToLive } from "./live-shelf.ts"

export const YoutubeLiveSearchChannel = makeApiChannel({
  key: "youtube:live-search",
  name: "YouTube 直播搜索",
  kind: "live",
  sourceInfoTpl: [{ key: "keyword", label: "搜索关键词", required: true }],
  channelTitle: (info) => `YouTube 直播搜索 ${info.keyword ?? ""}`,
  channelLink: "https://www.youtube.com/",
  fetchPage: async (info): Promise<Item[]> => {
    const kw = String(info.keyword ?? "").trim()
    if (!kw) throw new Error("youtube:live-search 需要 keyword 参数")
    const hits = await searchYouTubeLive(kw)
    const t = now()
    return hits.map((h) => youtubeLiveHitToLive("youtube:live-search", h, t))
  },
})
