/**
 * 开发环境种子订阅 —— **只被 dev 构建动态 import**,生产包不包含此文件。
 *
 * `store/index.ts` 在 `import.meta.env.DEV` 下 `await import("../dev/seed.ts")`
 * 调 `seedIfEmpty`;生产构建里这段分支被摇掉。
 *
 * ⚠️ 不要把这些源写进应用默认数据:含需登录、下播、测试性质的房间。
 *
 * **覆盖全部 channel**(一个 channel 一条),便于在本机逐项点测:
 *   - 需登录的渠道(`bili:dynamic` / `weibo:user`)**跳过或停用** —— 默认 cookie 为空,
 *     匿名请求必失败刷屏;
 *   - 关键词搜索类渠道(`*:search` / `*:anchor` / `searchBiliUsers` 等)放进「搜索」组,
 *     默认**停用**(它们是发现页入口,不该当常驻订阅;启用即测);
 *   - 36 条内置 RSS 直链属**同一实现**(`rss:hn` 代表),不逐一建订阅,避免糊满列表;
 *   - 旧渠道 `live:douyin:user` 保留给存量订阅,新入口用 `live:douyin`(主页链接),
 *     种子不重复。
 *
 * 数据供给以内置 crawler 为主:youtube/bili 视频、播客、直播、分区目录全走 crawler 渠道。
 *
 * 直播房间备选(当前房间下播/受限时换用):
 *   - douyu:   9999(yyfyyf)
 *   - bili:live:6
 *   - huya:    60066(主播「骚男」,2026-08 实测在播,蓝光20M 起 5 档)
 *   - douyin:  217952067344(2026-08-08 实测在播,原画/蓝光 5 档;
 *              ⚠️ room.status==2 才是直播中,==4 是 roomId 一次性需换 webRid,见 dart)
 *   - twitch:  shroud(离线也返 offline item,不会空订阅)
 */
import type { DataLayer, Subscription, SubscriptionGroup } from "@amoeba/core"

/** 分组种子(rail 的分组树)。只在**首次运行(空库)**写入,之后不覆盖。 */
const SEED_GROUPS: SubscriptionGroup[] = [
  { id: "g-article", title: "文章" },
  { id: "g-video", title: "视频" },
  { id: "g-audio", title: "音频" },
  { id: "g-live", title: "直播" },
  { id: "g-social", title: "社交" },
  { id: "g-category", title: "分区目录" },
  { id: "g-search", title: "搜索" },
]

const SEED_SUBSCRIPTIONS: Omit<Subscription, "createdAt" | "updatedAt">[] = [
  // ── 文章 ────────────────────────────────────────────────────────────────
  {
    id: "s-article",
    // ⚠️ 用**内置 rss:hn**,不用 `rsshub:feed` + `/hackernews`:
    // 公网 rsshub.app 常年 403(实测本网络下所有路由全 403),而内置直链零外部依赖。
    channelKey: "rss:hn",
    title: "Hacker News",
    enabled: true,
    groupId: "g-article",
    info: {},
  },
  // ── 视频 ────────────────────────────────────────────────────────────────
  {
    id: "s-video-youtube",
    channelKey: "youtube",
    title: "YouTube · 3Blue1Brown",
    enabled: true,
    groupId: "g-video",
    info: { channelId: "UCYO_jab_esuFRV4b17AJtAw" },
  },
  {
    id: "s-video-youtube-playlist",
    channelKey: "youtube:playlist",
    title: "YouTube 播放列表",
    enabled: true,
    groupId: "g-video",
    // 探针实测 15 条(官方 RSS 上限)
    info: { playlistId: "PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI" },
  },
  {
    id: "s-video-bili",
    channelKey: "bili:popular",
    title: "B站综合热门",
    enabled: true,
    groupId: "g-video",
    info: {},
  },
  {
    id: "s-video-bili-weekly",
    channelKey: "bili:weekly",
    title: "B站每周必看",
    enabled: true,
    groupId: "g-video",
    info: {},
  },
  {
    id: "s-video-bili-precious",
    channelKey: "bili:precious",
    title: "B站入站必刷",
    enabled: true,
    groupId: "g-video",
    info: {},
  },
  {
    id: "s-video-bili-ranking",
    channelKey: "bili:ranking",
    title: "B站排行榜",
    enabled: true,
    groupId: "g-video",
    info: {}, // rid 省略 = all
  },
  {
    id: "s-video-bili-user",
    channelKey: "bili:user_video",
    title: "B站 · 3Blue1Brown 投稿",
    enabled: true,
    groupId: "g-video",
    info: { uid: "511068914" },
  },
  {
    id: "s-video-bili-season",
    channelKey: "bili:season",
    title: "B站合集",
    enabled: true,
    groupId: "g-video",
    info: { seasonId: "2974525" }, // 探针实测 61 条
  },
  {
    id: "s-video-bili-series",
    channelKey: "bili:series",
    title: "B站视频列表",
    enabled: true,
    groupId: "g-video",
    info: { seriesId: "358495" }, // 探针实测 54 条
  },
  {
    id: "s-video-bili-favlist",
    channelKey: "bili:favlist",
    title: "B站公开收藏夹",
    enabled: true,
    groupId: "g-video",
    info: { mediaId: "1052622027" }, // 公开收藏夹,探针实测 28 条
  },

  // ── 音频 ────────────────────────────────────────────────────────────────
  {
    id: "s-audio",
    channelKey: "rss:podcast",
    title: "Huberman Lab",
    enabled: true,
    groupId: "g-audio",
    info: { url: "https://feeds.megaphone.fm/hubermanlab" },
  },
  {
    // 榜单条目是「节目容器」(kind audio 无 stream):点开 = 右侧展开单集,
    // 覆盖二级订阅预览链路。
    id: "s-audio-apple-chart",
    channelKey: "apple:podcast-chart",
    title: "Apple 播客热门榜",
    enabled: true,
    groupId: "g-audio",
    info: {},
  },

  // ── 直播 ────────────────────────────────────────────────────────────────
  {
    id: "s-video-youtube-live",
    channelKey: "youtube:live",
    title: "Claude FM 直播",
    enabled: true,
    groupId: "g-live",
    info: { videoId: "tRsQsTMvPNg" },
  },
  {
    id: "s-live-douyu",
    channelKey: "live:douyu",
    title: "斗鱼直播 · yyfyyf",
    enabled: true,
    groupId: "g-live",
    info: { roomIds: "9999" },
  },
  {
    id: "s-live-bili",
    channelKey: "bili:live",
    title: "B站直播",
    enabled: true,
    groupId: "g-live",
    info: { roomIds: "6" },
  },
  {
    id: "s-live-huya",
    channelKey: "live:huya",
    title: "虎牙直播 · 骚男",
    enabled: true,
    groupId: "g-live",
    info: { roomIds: "60066" },
  },
  {
    id: "s-live-douyin",
    channelKey: "live:douyin",
    title: "抖音直播 · 享受问号",
    enabled: true,
    groupId: "g-live",
    info: { roomIds: "217952067344" },
  },
  {
    id: "s-live-twitch",
    channelKey: "twitch:live",
    title: "Twitch 直播 · shroud",
    enabled: true,
    groupId: "g-live",
    info: { roomIds: "shroud" },
  },
  // 直播热门(开播房间发现源):无参订阅,列表即当前开播房间。
  {
    id: "s-live-hot-bili",
    channelKey: "bili:live:hot",
    title: "B站直播热门",
    enabled: true,
    groupId: "g-live",
    info: {}, // 匿名可用:防 -352 靠爬到请求里的匿名 buvid3,与 cookie 无关
  },
  {
    id: "s-live-hot-douyu",
    channelKey: "live:douyu:hot",
    title: "斗鱼直播热门",
    enabled: true,
    groupId: "g-live",
    info: {},
  },
  {
    id: "s-live-hot-huya",
    channelKey: "live:huya:hot",
    title: "虎牙直播热门",
    enabled: true,
    groupId: "g-live",
    info: {},
  },
  {
    id: "s-live-hot-douyin",
    channelKey: "live:douyin:hot",
    title: "抖音直播热门",
    enabled: true,
    groupId: "g-live",
    info: {},
  },
  {
    id: "s-live-hot-youtube",
    channelKey: "youtube:live-hot",
    title: "YouTube 直播热门",
    enabled: true,
    groupId: "g-live",
    info: {},
  },
  {
    id: "s-live-hot-twitch",
    channelKey: "twitch:hot",
    title: "Twitch 热门直播",
    enabled: true,
    groupId: "g-live",
    info: {},
  },
  // 分区直播(单分区订阅)
  {
    id: "s-live-cat-youtube",
    channelKey: "youtube:live-category",
    title: "YouTube 直播 · Gaming",
    enabled: true,
    groupId: "g-live",
    info: { category: "gaming" },
  },
  {
    id: "s-live-cat-twitch",
    channelKey: "twitch:category",
    title: "Twitch 分区 · Just Chatting",
    enabled: true,
    groupId: "g-live",
    info: { category: "just-chatting" },
  },
  {
    id: "s-live-cat-douyu",
    channelKey: "live:douyu:category",
    title: "斗鱼分区 · 英雄联盟",
    enabled: true,
    groupId: "g-live",
    info: { areaId: "1" },
  },
  {
    id: "s-live-cat-huya",
    channelKey: "live:huya:category",
    title: "虎牙分区 · 英雄联盟",
    enabled: true,
    groupId: "g-live",
    info: { gameId: "1" },
  },
  {
    id: "s-live-cat-douyin",
    channelKey: "live:douyin:category",
    title: "抖音分区 · 聊天",
    enabled: true,
    groupId: "g-live",
    info: { partition: "101", partitionType: "4" }, // 顶层分区:4 / 子分区:1
  },

  // ── 分区目录(内容 = kind:category 条目,点开 = 右侧预览该分区)──────────────
  {
    id: "s-cat-twitch",
    channelKey: "twitch:categories",
    title: "Twitch 分区列表",
    enabled: true,
    groupId: "g-category",
    info: {},
  },
  {
    id: "s-cat-youtube",
    channelKey: "youtube:live-categories",
    title: "YouTube 直播栏目",
    enabled: true,
    groupId: "g-category",
    info: {},
  },
  {
    id: "s-cat-douyu",
    channelKey: "live:douyu:categories",
    title: "斗鱼分区列表",
    enabled: true,
    groupId: "g-category",
    info: {},
  },
  {
    id: "s-cat-huya",
    channelKey: "live:huya:categories",
    title: "虎牙分区列表",
    enabled: true,
    groupId: "g-category",
    info: {},
  },
  {
    id: "s-cat-douyin",
    channelKey: "live:douyin:categories",
    title: "抖音分区列表",
    enabled: true,
    groupId: "g-category",
    info: {},
  },

  // ── 社交 ────────────────────────────────────────────────────────────────
  // 热搜榜三条(B站/微博/抖音):条目是**词条**不是文章,三个渠道 kind 都是 social。
  {
    id: "s-hot-bili",
    channelKey: "bili:square",
    title: "B站热搜",
    enabled: true,
    groupId: "g-social",
    info: {},
  },
  // 微博热搜:列表匿名可用(词流需登录),保留启用。
  {
    id: "s-hot-weibo",
    channelKey: "weibo:hot",
    title: "微博实时热搜",
    enabled: true,
    groupId: "g-social",
    info: {}, // 热搜三栏:中栏词条列表,点词条右栏该词微博流
  },
  {
    id: "s-social-douyin-trend",
    channelKey: "douyin:trend",
    title: "抖音热点榜",
    enabled: true,
    groupId: "g-social",
    info: {},
  },
  // ⚠️ **需登录**(匿名态已移除):先在「账号与凭证」扫码,再在 rail 里启用;
  // 未登录时刷新会报可操作错误,故 enabled:false 免刷屏。
  {
    id: "s-explore-xhs",
    channelKey: "xhs:explore",
    title: "小红书发现页",
    enabled: false,
    groupId: "g-social",
    info: {}, // 推荐内容,无参
  },
  {
    id: "s-user-xhs",
    channelKey: "xhs:user",
    title: "小红书 · 玛卡巴卡",
    enabled: false,
    groupId: "g-social",
    info: { user_id: "5c6d75a400000000100278fa" },
  },
  // ⚠️ **需登录 cookie**:settings.bilibiliCookie 默认空(纯匿名),匿名请求
  // bili 动态接口 412。故 **enabled:false** —— 扫码或手填 cookie(settings →
  // 账号与凭证)后在 rail 里启用即可;否则每次刷新必失败刷屏。
  {
    id: "s-social-bili-dyn",
    channelKey: "bili:dynamic",
    title: "B站动态 · 半佛仙人",
    enabled: false,
    groupId: "g-social",
    info: { uid: "37663924" }, // 硬核的半佛仙人(实测 37883317 是 DILI念,勿用)
  },
  // ⚠️ **需登录**:settings.weiboCookie 默认空,匿名 user 容器 432。enabled:false 同上。
  {
    id: "s-user-weibo",
    channelKey: "weibo:user",
    title: "微博 · LPL",
    enabled: false,
    groupId: "g-social",
    info: { uid: "5756404150" },
  },

  // ── 搜索(默认停用:关键词入口,启用即测)────────────────────────────────
  {
    id: "s-search-bili-keyword",
    channelKey: "bili:search",
    title: "B站搜索 · 英雄联盟",
    enabled: false,
    groupId: "g-search",
    info: { keyword: "英雄联盟" },
  },
  {
    id: "s-search-bili-anchor",
    channelKey: "bili:anchor",
    title: "B站搜主播 · 骚男",
    enabled: false,
    groupId: "g-search",
    info: { keyword: "骚男" },
  },
  {
    id: "s-search-bili-user",
    channelKey: "bili:user",
    title: "B站搜UP主 · 半佛仙人",
    enabled: false,
    groupId: "g-search",
    info: { keyword: "半佛仙人" },
  },
  {
    id: "s-search-youtube-user",
    channelKey: "youtube:user",
    title: "YouTube 搜频道 · MKBHD",
    enabled: false,
    groupId: "g-search",
    info: { keyword: "MKBHD" },
  },
  {
    id: "s-search-youtube-live",
    channelKey: "youtube:live-search",
    title: "YouTube 搜直播间 · lofi",
    enabled: false,
    groupId: "g-search",
    info: { keyword: "lofi" },
  },
  {
    id: "s-search-douyu",
    channelKey: "live:douyu:search",
    title: "斗鱼搜索 · 英雄联盟",
    enabled: false,
    groupId: "g-search",
    info: { keyword: "英雄联盟" },
  },
  {
    id: "s-search-douyu-anchor",
    channelKey: "live:douyu:anchor",
    title: "斗鱼搜主播 · yyf",
    enabled: false,
    groupId: "g-search",
    info: { keyword: "yyf" },
  },
  {
    id: "s-search-huya",
    channelKey: "live:huya:search",
    title: "虎牙搜索 · 英雄联盟",
    enabled: false,
    groupId: "g-search",
    info: { keyword: "英雄联盟" },
  },
  {
    id: "s-search-huya-anchor",
    channelKey: "live:huya:anchor",
    title: "虎牙搜主播 · 骚男",
    enabled: false,
    groupId: "g-search",
    info: { keyword: "骚男" },
  },
  {
    id: "s-search-douyin",
    channelKey: "live:douyin:search",
    title: "抖音分区搜索 · 音乐",
    enabled: false,
    groupId: "g-search",
    info: { keyword: "音乐" },
  },
  {
    id: "s-search-apple",
    channelKey: "apple:podcast-search",
    title: "Apple 播客搜索 · 科技",
    enabled: false,
    groupId: "g-search",
    info: { q: "科技" },
  },
]

/**
 * 种子只写一次:写过后落 `dev:seeded` 标记。这样「完全重置数据」或用户手动删空订阅后,
 * 下次启动不会又把测试源塞回来(首次开发者想恢复种子:删掉该 key 或整个 dev DB)。
 *
 * ⚠️ 改了种子列表后,**存量 dev 库不会自动补**——需「设置 → 存储与诊断 → 完全重置数据」
 * (或删 dev DB)再启动。
 */
const SEEDED_KEY = "dev:seeded"

/**
 * 空库且未写过种子时写入;其余情况直接返回。
 * 由 `store/index.ts` 在 DEV 下动态 import 调用 —— 生产构建不会包含本模块。
 */
export async function seedIfEmpty(dl: DataLayer): Promise<void> {
  // ⚠️ 标记放 localStorage（界面偏好域），不碰 appHost.storage：远端模式下
  // 桌面的 SQLite 已被 RejectingStorage 封死，第二个写者会破坏单写者契约。
  if (localStorage.getItem(SEEDED_KEY)) return
  const [subs, groups] = await Promise.all([dl.subscriptions.list(), dl.subscriptions.listGroups()])
  if (subs.length > 0 || groups.length > 0) {
    localStorage.setItem(SEEDED_KEY, "1")
    return
  }
  const t = Date.now()
  for (const g of SEED_GROUPS) await dl.subscriptions.addGroup({ ...g })
  for (const s of SEED_SUBSCRIPTIONS) {
    await dl.subscriptions.add({ ...s, createdAt: t, updatedAt: t })
  }
  localStorage.setItem(SEEDED_KEY, "1")
}
