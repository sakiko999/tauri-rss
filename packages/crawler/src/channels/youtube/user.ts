/**
 * youtube:user —— 搜频道(搜索渠道,不直接订阅)。
 *
 * InnerTube search + params=EgIQAg==(只返回频道;取数在 resolve/platform/youtube/
 * client.ts 的 searchYouTubeChannels,匿名)。产出 Video item:每个频道一条,
 * url = channel 页 —— 候选提取从 url 解析 channelId(raw 不穿 XML 边界)。
 *
 * 下游订阅走 `youtube` 渠道(channelId 参数):角色同 `bili:search` 之于 `bili:live`,
 * 只作「搜索添加」的取数源。
 */
import type { Video } from "@amoeba/xml"
import { makeApiChannel } from "../factory.ts"
import { now, searchYouTubeChannels } from "@amoeba/resolve"

export const YoutubeUserChannel = makeApiChannel({
  key: "youtube:user",
  name: "YouTube 搜频道",
  kind: "video",
  sourceInfoTpl: [{ key: "keyword", label: "频道关键词", placeholder: "如:MKBHD", required: true }],
  channelTitle: (info) => `YouTube 搜频道 ${info.keyword ?? ""}`,
  channelLink: "https://www.youtube.com/",
  fetchPage: async (info) => {
    const kw = String(info.keyword ?? "").trim()
    if (!kw) throw new Error("youtube:user 需要 keyword 参数")
    const channels = await searchYouTubeChannels(kw)
    const t = now()
    return channels.map((c): Video => ({
      id: `ch-${c.channelId}`,
      sourceId: "youtube:user",
      kind: "video",
      title: c.title,
      url: `https://www.youtube.com/channel/${c.channelId}`,
      thumbnail: c.thumb,
      // 候选行的次行信息(订阅数;raw 不穿 XML,summary 是唯一能到 UI 的自由字段)。
      summary: [c.subsText, c.videoCountText].filter(Boolean).join(" · ") || undefined,
      fetchedAt: t,
    }))
  },
})
