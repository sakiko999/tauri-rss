/**
 * twitch:user:search —— 按关键词搜 Twitch 频道(搜索渠道,不直接订阅)。
 *
 * 取数在 resolve `searchTwitchChannels`(匿名 GraphQL `searchFor`,实测 2026-11-01
 * 原始查询即返回 channels.items,不需要 persisted token / integrity)。产出 Video
 * item,url = 频道页 —— 候选提取从 url 解析 login。
 *
 * 下游订阅走 `twitch:live`(roomIds 参数 = 频道 login),本渠道只作「搜索添加」的取数源。
 */

import { now, searchTwitchChannels } from "@amoeba/resolve"
import type { Video } from "@amoeba/xml"

import { makeApiChannel } from "../factory.ts"

/** 关注数缩写:1.2万 / 3.4亿(与桌面候选行同一读数)。 */
function fmtCount(n: number): string {
  if (n >= 1e8) return `${(n / 1e8).toFixed(1).replace(/\.0$/, "")}亿`
  if (n >= 1e4) return `${(n / 1e4).toFixed(1).replace(/\.0$/, "")}万`
  return String(n)
}

export const TwitchUserSearchChannel = makeApiChannel({
  key: "twitch:user:search",
  name: "Twitch 搜频道",
  kind: "video",
  sourceInfoTpl: [{ key: "keyword", label: "主播/频道关键词", placeholder: "如:shroud", required: true }],
  channelTitle: (info) => `Twitch 搜频道 ${info.keyword ?? ""}`,
  channelLink: "https://www.twitch.tv/",
  fetchPage: async (info) => {
    const kw = String(info.keyword ?? "").trim()
    if (!kw) throw new Error("twitch:user:search 需要 keyword 参数")
    const hits = await searchTwitchChannels(kw)
    const t = now()
    return hits.map((h): Video => {
      const desc = h.description.length > 60 ? `${h.description.slice(0, 60)}…` : h.description
      return {
        id: `tw-${h.login}`,
        sourceId: "twitch:user:search",
        kind: "video",
        title: h.displayName,
        url: `https://www.twitch.tv/${h.login}`,
        // 候选行的次行信息(raw 不穿 XML,summary 是唯一到 UI 的自由字段)。
        summary: [h.followers ? `${fmtCount(h.followers)} 关注者` : "", desc].filter(Boolean).join(" · ") || undefined,
        fetchedAt: t,
      }
    })
  },
})
