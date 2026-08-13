/**
 * 测试订阅清单 —— 覆盖不同 kind + 真实可播演示源。
 *
 * 更新说明:
 *   - live:douyu 替换原 live:huya(当时 huya 未实现;现 huya 已走 HTTP-FLV,见
 *     packages/crawler/src/channels/huya/play.ts)
 *   - bili:live 补充直播演示(需直播中的房间)
 *   - live:huya / live:douyin 补充多平台直播演示(roomId 需在线,离线时无流)
 *
 * YouTube 直播订阅方式:**youtube:live channel**(kind 固定 live,零判定请求)——videoId
 * 声明即直播,如 `tRsQsTMvPNg`(Claude FM 常驻直播,hls.js 播放)。
 * 普通视频订阅用 `youtube` channel(channelId 订阅频道 / videoId 订阅单视频)。
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
    channelKey: "youtube:live",
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
  // 直播热门(开播房间发现源):无参订阅,列表即当前开播房间;
  // source 委托同平台 live 的 resolveLivePlay/getDanmaku,点卡片即可播放+弹幕。
  {
    id: "s-live-hot-bili",
    channelKey: "bili:live:hot",
    title: "bilibili 直播热门",
    enabled: true,
    info: {}, // 需 cookie 防 getListByArea -352(core DEFAULT_BILIBILI_COOKIE 自动注入)
  },
  {
    id: "s-live-hot-douyu",
    channelKey: "live:douyu:hot",
    title: "斗鱼直播热门",
    enabled: true,
    info: {},
  },
  {
    id: "s-live-hot-huya",
    channelKey: "live:huya:hot",
    title: "虎牙直播热门",
    enabled: true,
    info: {},
  },
  {
    id: "s-live-hot-douyin",
    channelKey: "live:douyin:hot",
    title: "抖音直播热门",
    enabled: true,
    info: {},
  },
  // social:需登录 cookie(未登录 bili 动态接口返回 code:-101)。core 层
  // DEFAULT_BILIBILI_COOKIE 经 sourceInfoFor 自动注入,桌面端开箱即用。
  {
    id: "s-social-bili-dyn",
    channelKey: "bili:dynamic",
    title: "bilibili 动态 · 半佛仙人",
    enabled: true,
    info: { uid: "37663924" }, // 硬核的半佛仙人(实测 37883317 是 DILI念,勿用)
  },
  // 微博(完整登录 cookie 在 core 层 DEFAULT_WEIBO_COOKIE,sourceInfoFor 自动注入)
  {
    id: "s-hot-weibo",
    channelKey: "weibo:hot",
    title: "微博实时热搜",
    enabled: true,
    info: {}, // 热搜三栏:中栏词条列表,点词条右栏该词微博流
  },
  {
    id: "s-user-weibo",
    channelKey: "weibo:user",
    title: "微博 · 何炅",
    enabled: true,
    info: { uid: "1195230310" },
  },
  // 小红书(核心 cookie 在 core 层 DEFAULT_XHS_COOKIE,纯 HTTP SSR)
  {
    id: "s-explore-xhs",
    channelKey: "xhs:explore",
    title: "小红书发现页",
    enabled: true,
    info: {}, // 推荐内容,无参
  },
  {
    id: "s-user-xhs",
    channelKey: "xhs:user",
    title: "小红书 · 小宇菇菇",
    enabled: true,
    info: { user_id: "593032945e87e77791e03696" },
  },
]
