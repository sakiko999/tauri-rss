/**
 * FeedItem — the producer's *internal protocol* shape.
 *
 * NOT the app content model. Structured intermediate that source adapters emit
 * and the serializer turns into RSS 2.0 (+ tpl:) XML. Core owns the rendered
 * MediaItem union (unread/starred/subscriptionId are app-layer semantics and
 * are NOT part of this protocol); producer never imports core — types are
 * duplicated here by design (protocol vs render model).
 *
 * The `tpl:` namespace extension is keyed on `kind`, so this stays a
 * discriminated union (mirrors the pre-move MediaItem shape) to keep adapters
 * and the serializer/deserializer switch minimal.
 */

export type FeedKind = "article" | "social" | "video" | "audio" | "live"

export interface FeedAuthor {
  name: string
  avatar?: string
  handle?: string
}

export type FeedStreamingFormat = "hls" | "dash" | "progressive"

export interface FeedItemBase {
  id: string
  sourceId: string
  kind: FeedKind
  title: string
  url?: string
  summary?: string
  thumbnail?: string
  author?: FeedAuthor
  publishedAt?: number
  fetchedAt: number
  raw?: unknown
  /** Protocol-nullable; core injects `?? true` when bridging to MediaItem. */
  isUnread?: boolean
  /** Protocol-nullable; core injects `?? false` when bridging to MediaItem. */
  isStarred?: boolean
  mimeType?: string
  poster?: string
  width?: number
  height?: number
  aspectRatio?: number
  durationSec?: number
  bitrate?: number
  streamingFormat?: FeedStreamingFormat
  isLiveNow?: boolean
  lang?: string
}

export interface FeedArticle extends FeedItemBase {
  kind: "article"
  content?: string
  contentFormat?: "html" | "markdown" | "text"
  media?: FeedAttachment[]
}

export interface FeedSocial extends FeedItemBase {
  kind: "social"
  content: string
  images?: string[]
  likes?: number
  reposts?: number
  replies?: number
  isLiked?: boolean
}

export interface FeedStream {
  url: string
  format?: string
  headers?: Record<string, string>
}

export type FeedAttachmentKind = "image" | "video" | "audio" | "live"
export interface FeedAttachment {
  kind: FeedAttachmentKind
  url: string
  title?: string
  mimeType?: string
  poster?: string
  width?: number
  height?: number
  aspectRatio?: number
  durationSec?: number
  bitrate?: number
  streamingFormat?: FeedStreamingFormat
  isLiveNow?: boolean
  lang?: string
}

export interface FeedVideo extends FeedItemBase {
  kind: "video"
  duration?: number
  stream?: FeedStream
  channel?: { name: string; avatar?: string }
}

export interface FeedAudio extends FeedItemBase {
  kind: "audio"
  duration?: number
  artist?: string
  album?: string
  stream?: FeedStream
}

export type FeedLiveStatus = "live" | "offline" | "unknown"
export type FeedLivePlatformId = "bilibili" | "douyu" | "huya" | "douyin"

export interface FeedLive extends FeedItemBase {
  kind: "live"
  platform: FeedLivePlatformId
  roomId: string
  liveStatus: FeedLiveStatus
  online?: number
  isRecord?: boolean
  introduction?: string
  notice?: string
  showTime?: string
  playUrls?: string[]
  playHeaders?: Record<string, string>
  quality?: string
  playUrlsExpiresAt?: number
}

export type FeedItem =
  | FeedArticle
  | FeedSocial
  | FeedVideo
  | FeedAudio
  | FeedLive
