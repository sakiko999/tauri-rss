/**
 * 内置 channel 登记函数(无幂等守卫,由 index.ts 的惰性注册调用)。
 *
 * 新增渠道:在对应平台目录实现 class,然后在这里登记。
 */
import { registerChannel } from "./index.ts"
import { RawRssChannel, RssPodcastChannel, RSS_BUILTIN_FEEDS } from "./channels/rss/index.ts"
import {
  BiliSquareChannel,
  BiliPopularChannel,
  BiliRankingChannel,
  BiliWeeklyChannel,
  BiliUserVideoChannel,
  BiliLiveChannel,
  BiliDynamicChannel,
} from "./channels/bili/index.ts"
import { YoutubeChannel, YoutubeLiveChannel } from "./channels/youtube/index.ts"
import { HuyaLiveChannel } from "./channels/huya/index.ts"
import { DouyuLiveChannel } from "./channels/douyu/index.ts"
import { DouyinLiveChannel } from "./channels/douyin/index.ts"
import { WeiboUserChannel, WeiboHotChannel } from "./channels/weibo/index.ts"
import { XhsUserChannel, XhsExploreChannel } from "./channels/xhs/index.ts"

/** 注册所有内置 channel。无守卫——由调用方(index.ts)保证幂等。 */
export function registerBuiltinChannels(): void {
  // ── 原生 RSS 直链(批量注册 36 条内置清单,kind 标注在清单里)──
  // 内置清单里 kind=video 的直链(如 YouTube 官方 feed)即声明视频可播放力。
  for (const f of RSS_BUILTIN_FEEDS) {
    registerChannel(new RawRssChannel(`rss:${f.id}`, f.title, f.kind, f.url, f.kind === "video"))
  }

  // ── 播客 RSS(解析 enclosure/itunes → AudioItem)──
  registerChannel(new RssPodcastChannel())

  // ── bilibili(wbi 签名 API,零登录)──
  registerChannel(new BiliSquareChannel())
  registerChannel(new BiliPopularChannel())
  registerChannel(new BiliRankingChannel())
  registerChannel(new BiliWeeklyChannel())
  registerChannel(new BiliUserVideoChannel())
  registerChannel(new BiliLiveChannel())
  registerChannel(new BiliDynamicChannel())

  // ── YouTube(官方 RSS 视频 + 直播订阅)──
  registerChannel(new YoutubeChannel())
  registerChannel(new YoutubeLiveChannel())

  // ── huya 直播(纯 HTTP,零签名)──
  registerChannel(new HuyaLiveChannel())

  // ── douyu / douyin 直播(需 host.js 执行 cryptojs/abogus blob)──
  registerChannel(new DouyuLiveChannel())
  registerChannel(new DouyinLiveChannel())

  // ── 微博(用户主页 + 实时热搜;完整登录 cookie 解锁 container/getIndex)──
  registerChannel(new WeiboUserChannel())
  registerChannel(new WeiboHotChannel())

  // ── 小红书(用户笔记 + 发现页推荐;cookie 纯 HTTP 直连 SSR)──
  registerChannel(new XhsUserChannel())
  registerChannel(new XhsExploreChannel())
}
