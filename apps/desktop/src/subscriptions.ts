/**
 * 测试订阅清单 —— 覆盖不同 kind + 真实可播演示源。
 *
 * 更新说明:
 *   - live:douyu 替换原 live:huya(huya 直播流 Tars codec 未实现,无法播放;
 *     douyu 是 HTTP-FLV,flv.js 可播,实测 40/40 房间成功)
 *   - bili:live 补充直播演示(需直播中的房间)
 */
import type { Subscription } from "@tauri-playground/core"

export const TEST_SUBSCRIPTIONS: Omit<Subscription, "createdAt" | "updatedAt">[] = [
  {
    id: "s-article",
    channelKey: "rss:hn",
    title: "Hacker News",
    enabled: true,
    info: {}, // RawRssChannel 用内置 defaultUrl
  },
  {
    id: "s-video-youtube",
    channelKey: "youtube",
    title: "YouTube · 3Blue1Brown",
    enabled: true,
    info: { channelId: "UCYO_jab_esuFRV4b17AJtAw" },
  },
  {
    id: "s-video-bili",
    channelKey: "bili:popular",
    title: "bilibili 综合热门",
    enabled: true,
    info: {},
  },
  {
    id: "s-audio",
    channelKey: "rss:podcast",
    title: "Huberman Lab",
    enabled: true,
    info: { url: "https://feeds.megaphone.fm/hubermanlab" },
  },
  {
    id: "s-live-douyu",
    channelKey: "live:douyu",
    title: "斗鱼直播 · yyfyyf",
    enabled: true,
    info: { roomId: "9999" },
  },
  {
    id: "s-live-bili",
    channelKey: "bili:live",
    title: "bilibili 直播",
    enabled: true,
    info: { roomId: "6" },
  },
]
