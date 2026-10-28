import { ApplePodcastChartChannel, ApplePodcastSearchChannel } from "./channels/apple/index.ts"
import {
  BiliAnchorChannel,
  BiliDynamicChannel,
  BiliFavlistChannel,
  BiliLiveAreaChannel,
  BiliLiveAreasChannel,
  BiliLiveChannel,
  BiliLiveHotChannel,
  BiliPopularChannel,
  BiliPreciousChannel,
  BiliRankingChannel,
  BiliSearchChannel,
  BiliSeasonChannel,
  BiliSeriesChannel,
  BiliSquareChannel,
  BiliUserChannel,
  BiliUserVideoChannel,
  BiliWeeklyChannel,
} from "./channels/bili/index.ts"
import {
  DouyinCategoriesChannel,
  DouyinCategoryChannel,
  DouyinLiveChannel,
  DouyinLiveHotChannel,
  DouyinPartitionSearchChannel,
  DouyinTrendChannel,
  DouyinUserLiveChannel,
} from "./channels/douyin/index.ts"
import {
  DouyuAnchorChannel,
  DouyuCategoriesChannel,
  DouyuCategoryChannel,
  DouyuLiveChannel,
  DouyuLiveHotChannel,
  DouyuSearchChannel,
} from "./channels/douyu/index.ts"
import {
  HuyaAnchorChannel,
  HuyaCategoriesChannel,
  HuyaCategoryChannel,
  HuyaLiveChannel,
  HuyaLiveHotChannel,
  HuyaSearchChannel,
} from "./channels/huya/index.ts"
import { RawRssChannel, RSS_BUILTIN_FEEDS, RssPodcastChannel } from "./channels/rss/index.ts"
import {
  TwitchCategoriesChannel,
  TwitchCategoryChannel,
  TwitchHotChannel,
  TwitchLiveChannel,
} from "./channels/twitch/index.ts"
import { WeiboHotChannel, WeiboUserChannel } from "./channels/weibo/index.ts"
import { XhsExploreChannel, XhsUserChannel } from "./channels/xhs/index.ts"
import {
  YoutubeChannel,
  YoutubeLiveCategoriesChannel,
  YoutubeLiveCategoryChannel,
  YoutubeLiveChannel,
  YoutubeLiveHotChannel,
  YoutubeLiveSearchChannel,
  YoutubePlaylistChannel,
  YoutubeUserChannel,
} from "./channels/youtube/index.ts"
/**
 * 内置 channel 登记函数(无幂等守卫,由 index.ts 的惰性注册调用)。
 *
 * 新增渠道:在对应平台目录实现 class,然后在这里登记。
 */
import { registerChannel } from "./index.ts"

/** 注册所有内置 channel。无守卫——由调用方(index.ts)保证幂等。 */
export function registerBuiltinChannels(): void {
  // ── 原生 RSS 直链(批量注册 36 条内置清单,kind 标注在清单里)──
  for (const f of RSS_BUILTIN_FEEDS) {
    registerChannel(new RawRssChannel(`rss:${f.id}`, f.title, f.kind, f.url))
  }

  // ── 播客 RSS(解析 enclosure/itunes → AudioItem)──
  registerChannel(RssPodcastChannel)
  // Apple 播客目录(发现层):榜单 / 搜索。产出 kind:audio,url = 该节目的 RSS feed
  // (接进 rss:podcast 的同一条路)。⚠️ Apple 目录是**元数据源**,榜单不含 feedUrl,
  // 要两次请求(lookup);详见 resolve/platform/apple/catalog.ts 的文件头。
  registerChannel(ApplePodcastChartChannel)
  registerChannel(ApplePodcastSearchChannel)

  // 通用 RSS 直链(任意 URL,透传上游 XML)——OPML 导入的外部 feed 与手工订阅
  // 「已知 URL 的 RSS」都用它。预置清单(key `rss:{id}`)是它的一批默认实例。
  registerChannel(new RawRssChannel("rss:url", "RSS 直链", "article"))

  // ── bilibili(wbi 签名 API,零登录)──
  registerChannel(BiliSquareChannel)
  registerChannel(BiliPopularChannel)
  registerChannel(BiliPreciousChannel)
  registerChannel(BiliRankingChannel)
  registerChannel(BiliWeeklyChannel)
  registerChannel(BiliUserVideoChannel)
  registerChannel(new BiliLiveChannel())
  registerChannel(BiliLiveHotChannel)
  registerChannel(BiliLiveAreasChannel)
  registerChannel(BiliLiveAreaChannel)
  registerChannel(new BiliSeasonChannel())
  registerChannel(new BiliSeriesChannel())
  registerChannel(BiliFavlistChannel)
  registerChannel(new BiliDynamicChannel())
  registerChannel(BiliSearchChannel)
  registerChannel(BiliAnchorChannel)
  registerChannel(new BiliUserChannel())

  // ── YouTube(官方 RSS 视频 + 直播订阅)──
  registerChannel(new YoutubeChannel())
  registerChannel(YoutubePlaylistChannel)
  registerChannel(YoutubeLiveChannel)
  registerChannel(YoutubeLiveHotChannel)
  registerChannel(YoutubeLiveCategoryChannel)
  registerChannel(YoutubeLiveCategoriesChannel)
  registerChannel(YoutubeLiveSearchChannel)
  registerChannel(YoutubeUserChannel)

  // ── Twitch 直播(匿名 GraphQL;频道订阅 + 热门/分区列表)──
  registerChannel(new TwitchLiveChannel())
  registerChannel(new TwitchHotChannel())
  registerChannel(new TwitchCategoryChannel())
  registerChannel(TwitchCategoriesChannel)

  // ── huya 直播(纯 HTTP,零签名;单房间 + 热门列表)──
  registerChannel(new HuyaLiveChannel())
  registerChannel(HuyaLiveHotChannel)
  registerChannel(HuyaCategoryChannel)
  registerChannel(new HuyaCategoriesChannel())
  registerChannel(HuyaSearchChannel)
  registerChannel(HuyaAnchorChannel)

  // ── douyu / douyin 直播(需 host.js 执行 cryptojs/abogus blob;单房间 + 热门列表)──
  registerChannel(new DouyuLiveChannel())
  registerChannel(DouyuLiveHotChannel)
  registerChannel(DouyuCategoryChannel)
  registerChannel(DouyuCategoriesChannel)
  registerChannel(DouyuSearchChannel)
  registerChannel(DouyuAnchorChannel)
  registerChannel(new DouyinLiveChannel())
  registerChannel(DouyinLiveHotChannel)
  registerChannel(DouyinCategoryChannel)
  registerChannel(DouyinCategoriesChannel)
  registerChannel(DouyinPartitionSearchChannel)
  registerChannel(new DouyinUserLiveChannel())
  registerChannel(DouyinTrendChannel)

  // ── 微博(用户主页 + 实时热搜;完整登录 cookie 解锁 container/getIndex)──
  registerChannel(new WeiboUserChannel())
  registerChannel(new WeiboHotChannel())

  // ── 小红书(用户笔记 + 发现页推荐;cookie 纯 HTTP 直连 SSR)──
  registerChannel(new XhsUserChannel())
  registerChannel(new XhsExploreChannel())
}
