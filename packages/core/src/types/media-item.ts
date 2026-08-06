/**
 * MediaItem — core 自建的渲染模型(app 内容模型)。
 *
 * 由 core 的 XML deserializer 从 crawler 输出的 RSS 2.0 + `tpl:` XML 还原,
 * 叠加 app 层语义(subscriptionId / isUnread / isStarred)。判别联合 keyed on
 * `kind`,app 层按 kind 收窄渲染。
 *
 * Kind 集:`article | social | video | audio | live`,无独立 image kind——
 * 图片进 `ArticleItem.media[]` 作为附件。
 */
import type { LivePlatformId, LiveStatus } from "./live.ts"

/** 渲染层认识的媒体种类。 */
export type MediaKind = "article" | "social" | "video" | "audio" | "live"

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
  /** 不透明源负载,保真 round-trip。 */
  raw?: unknown

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
  images?: string[]
  likes?: number
  reposts?: number
  replies?: number
  isLiked?: boolean
}

/** 可播流 + 投递提示。 */
export interface MediaStream {
  url: string
  format?: string
  headers?: Record<string, string>
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

/** 直播房间。refresh 时只有状态 + 元数据;playUrls 由懒解析填充。 */
export interface LiveItem extends MediaItemBase {
  kind: "live"
  platform: LivePlatformId
  roomId: string
  liveStatus: LiveStatus
  online?: number
  isRecord?: boolean
  introduction?: string
  notice?: string
  showTime?: string
  /** 懒解析填充(resolveLivePlay),带 expiry 签名,过期须重解析。 */
  playUrls?: string[]
  playHeaders?: Record<string, string>
  quality?: string
  playUrlsExpiresAt?: number
}

export type MediaItem =
  | ArticleItem
  | SocialItem
  | VideoItem
  | AudioItem
  | LiveItem
