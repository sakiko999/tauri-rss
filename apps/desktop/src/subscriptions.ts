/**
 * 测试订阅清单 —— 覆盖不同 kind + 真实可播演示源。
 *
 * 更新说明:
 *   - live:douyu 替换原 live:huya(当时 huya 未实现;现 huya 已走 HTTP-FLV,见
 *     packages/crawler/src/channels/huya/play.ts)
 *   - bili:live 补充直播演示(需直播中的房间)
 *   - live:huya / live:douyin 补充多平台直播演示(roomId 需在线,离线时无流)
 *
 * YouTube 直播订阅方式:youtube channel 支持 videoId 直接订阅单视频/直播,
 * 如 `tRsQsTMvPNg`(Claude FM 常驻直播,hls.js 播放)。
 *
 * 直播房间备选(当前房间下播/受限时换用):
 *   - douyu:   9999(yyfyyf)
 *   - bili:live:6
 *   - huya:    60066(主播「骚男」,2026-08 实测在播,蓝光20M 起 5 档)
 *   - douyin:  217952067344(2026-08-08 实测在播,原画/蓝光 5 档;
 *              ⚠️ room.status==2 才是直播中,==4 是 roomId 一次性需换 webRid,见 dart)
 *   huya 在播房间可从 www.huya.com/l 页实时列表取(WebFetch 可见)。
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
    id: "s-video-youtube-live",
    channelKey: "youtube",
    title: "Claude FM 直播",
    enabled: true,
    info: { videoId: "tRsQsTMvPNg" },
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
  {
    id: "s-live-huya",
    channelKey: "live:huya",
    title: "虎牙直播 · 骚男",
    enabled: true,
    info: { roomId: "60066" },
  },
  {
    id: "s-live-douyin",
    channelKey: "live:douyin",
    title: "抖音直播 · 享受问号",
    enabled: true,
    info: { roomId: "217952067344" },
  },
  // social:需登录 cookie(未登录 bili 动态接口返回 code:-101)。core 层
  // DEFAULT_BILIBILI_COOKIE 经 sourceInfoFor 自动注入,桌面端开箱即用。
  {
    id: "s-social-bili-dyn",
    channelKey: "bili:dynamic",
    title: "bilibili 动态 · 半佛仙人",
    enabled: true,
    info: { uid: "37883317" },
  },
]
