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
 * 直播房间备选(当前房间下播/受限时换用;douyin 受限报 4001038):
 *   - douyu:   9999(yyfyyf)
 *   - bili:live:6
 *   - huya:    527988(游戏区在线主播,不定)
 *   - douyin:  706293310661(奶酪)、84139699615(DNF)、429692277417(桃兵)、
 *              797182238243(猫腻)、458369128783(于二)
 *   更准的方式:douyin 用 live.douyin.com 分区接口实时抓在播房间
 *   (packages/crawler/src/channels/douyin/ 的 ABogus 签名 + partition v2)。
 *   ⚠️ douyin 订阅必须用 web_rid(短号,如 706293310661),不能用 room_id(长号)。
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
    title: "虎牙直播",
    enabled: true,
    info: { roomId: "527988" },
  },
  {
    id: "s-live-douyin",
    channelKey: "live:douyin",
    title: "抖音直播",
    enabled: true,
    info: { roomId: "706293310661" },
  },
]
