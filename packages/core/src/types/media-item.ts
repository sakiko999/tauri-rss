/**
 * MediaItem — core 自建的渲染模型(app 内容模型)。
 *
 * 由 core 的 XML deserializer 从 crawler 输出的 RSS 2.0 + `tpl:` XML 还原,
 * 叠加 app 层语义(subscriptionId / isUnread / isStarred)。判别联合 keyed on
 * `kind`,app 层按 kind 收窄渲染。
 *
 * Kind 集:`article | social | video | audio | live | category`,无独立 image kind——
 * 图片进 `ArticleItem.media[]` 作为附件。`category` 是「分区目录」条目:本身不可播,
 * `categoryChannel`/`categoryInfo` 指向点开后的目标渠道实例。
 */

import type { LivePlatformId, LiveStatus } from "./live.ts"

/** 渲染层认识的媒体种类。 */
export type MediaKind = "article" | "social" | "video" | "audio" | "live" | "category"

/** 社交图片,带可选宽高(瀑布流 span 用)。宽高未知时省略,UI 退化默认比例。 */
export interface SocialImage {
  url: string
  width?: number
  height?: number
  /** 实况图的短视频直链；静态图 `url` 即 poster。见 xml 包同名类型注释。 */
  liveVideo?: string
}

/** 与条目关联的作者/账号(文章署名、视频频道等)。 */
export interface MediaAuthor {
  name: string
  avatar?: string
  handle?: string
}

/** 可播流的投递提示。 */
export type StreamingFormat = "hls" | "dash" | "progressive"

/** 每种媒体条目的公共字段。 */
export interface MediaItemBase {
  /** 源内稳定唯一 id(RSS guid / 直播 roomId / …)。 */
  id: string
  /** 所属订阅。条目按此 join 到配置。 */
  subscriptionId: string
  kind: MediaKind
  title: string
  url?: string
  summary?: string
  thumbnail?: string
  author?: MediaAuthor
  /** Unix epoch ms。源无时间戳时省略。 */
  publishedAt?: number
  /** Unix epoch ms —— 数据层抓取时间。 */
  fetchedAt: number
  /** 用户状态。新条目默认 true,已读时清除。 */
  isUnread?: boolean
  isStarred?: boolean
  /**
   * 续播位置(秒)。仅 video/audio 有义;live 不记。与 isStarred 同款:
   * 播放页写、refresh 时由 core 从 reading 回填(见 data-layer `applyReadingState`)。
   */
  positionSec?: number
  /**
   * 文章阅读进度(0..1 滚动比例)。article 有义;与 positionSec 同款:
   * 阅读器写、refresh 时由 core 从 reading 回填。
   */
  scrollRatio?: number
  /**
   * 最近一次产生阅读态的时间(已读/星标/续播/滚动任一,Unix epoch ms)。
   * 由 core applyReadingState 从 reading.lastReadAt 回填。「继续」智能订阅按它排序
   * (最近观看优先),否则只会按 publishedAt 排、失去「接着上次看」的语义。
   */
  lastReadAt?: number

  // ── 渲染 / 播放提示 ──────────────────────────────────────────────
  mimeType?: string
  poster?: string
  width?: number
  height?: number
  aspectRatio?: number
  durationSec?: number
  bitrate?: number
  streamingFormat?: StreamingFormat
  isLiveNow?: boolean
  lang?: string
}

/** 长文正文(博客、新闻、RSS item)。 */
export interface ArticleItem extends MediaItemBase {
  kind: "article"
  content?: string
  contentFormat?: "html" | "markdown" | "text"
  /** 从源提取的媒体附件(enclosure / media:content)。 */
  media?: MediaAttachment[]
}

/** 短社交动态(tweet 类,带互动数)。 */
export interface SocialItem extends MediaItemBase {
  kind: "social"
  content: string
  /** 图片列表(可带宽高,瀑布流 span 用;宽高未知时退化默认比例)。 */
  images?: SocialImage[]
  likes?: number
  reposts?: number
  replies?: number
  isLiked?: boolean
  /** 小红书笔记详情开关(列表项 xsec_token;匿名 GET /explore/<id> 需带才返回 noteDetailMap)。 */
  xsecToken?: string
}

/** 可播流 + 投递提示。 */
export interface MediaStream {
  url: string
  format?: string
  headers?: Record<string, string>
  /** 档位名(直播多清晰度流,如 douyu 的「原画2K60/蓝光8M」;单流无)。 */
  quality?: string
  /** 档位原始值(直播平台切档参数,如 douyu 的 rate);切档重解析时按它重发请求。 */
  rate?: number
  /** DASH manifest(MPD XML)——音视频分离流(如 B 站视频)用 dash.js 合成播放。 */
  dashManifest?: string
}

/** 文章内嵌附件(ArticleItem.media[])。 */
export type MediaAttachmentKind = "image" | "video" | "audio" | "live"

export interface MediaAttachment {
  kind: MediaAttachmentKind
  url: string
  title?: string
  mimeType?: string
  poster?: string
  width?: number
  height?: number
  aspectRatio?: number
  durationSec?: number
  bitrate?: number
  streamingFormat?: StreamingFormat
  isLiveNow?: boolean
  lang?: string
}

/** 托管视频片段(VOD)。与直播流区分 —— 见 LiveItem。 */
export interface VideoItem extends MediaItemBase {
  kind: "video"
  duration?: number
  /** 会员/付费专属（B站大会员/充电、YouTube 频道会员）—— 列表可见但播放受限。 */
  membersOnly?: boolean
  stream?: MediaStream
  channel?: { name: string; avatar?: string }
}

/** 托管音频片段(播客 / 音乐)。 */
export interface AudioItem extends MediaItemBase {
  kind: "audio"
  duration?: number
  artist?: string
  album?: string
  stream?: MediaStream
}

/** 直播房间。refresh 时只有状态 + 元数据;可播流走 resolveLivePlay 懒解析,不在此。 */
export interface LiveItem extends MediaItemBase {
  kind: "live"
  platform: LivePlatformId
  roomId: string
  liveStatus: LiveStatus
  online?: number
  isRecord?: boolean
  introduction?: string
  showTime?: string
  /** ⚠️ 可播流/档位字段不在刷新模型里:playUrls/playHeaders/quality 零读写已删,
   *  可播流统一由 `resolveLivePlay` 按 url 懒解析。 */
}

/**
 * 分区目录条目(订阅的内容是「分类列表」,如 Twitch 分类榜)。
 * 点开时用 `previewChannel(categoryChannel, categoryInfo)` 取该分区的真实内容,
 * 并可把同一份参数交给 `addSubscription` 订阅该分区。
 */
export interface CategoryItem extends MediaItemBase {
  kind: "category"
  categoryChannel: string
  categoryInfo: Record<string, string>
}

export type MediaItem = ArticleItem | SocialItem | VideoItem | AudioItem | LiveItem | CategoryItem
