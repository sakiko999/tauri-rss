/**
 * Media item types — the unified content model the app layer renders.
 *
 * A `MediaItem` is a discriminated union keyed on `kind`. Each variant carries
 * the fields that kind requires (not optional), so the app layer narrows on
 * `kind` and renders accordingly. `raw?: unknown` carries the opaque source
 * payload (mirrors dart `LiveRoomDetail.data` escape hatch) for lossless
 * round-tripping when a source field has no mapped home yet.
 *
 * Design note: this replaces rss-reader's flat-optional model (where
 * `Article`/`VideoItem`/… sat side-by-side on one `FeedItem`). A union keeps
 * kind-specific data guaranteed-present after narrowing.
 *
 * Kind set: `article | social | video | audio | live`. There is NO standalone
 * `image` kind — images are extracted into `ArticleItem.media[]` as attachments
 * (see `source/rss/media.ts`). This reflects the reader's primary flows
 * (articles + video/audio playback + live streams) while keeping `social`
 * available for short-form posts.
 */

/** The set of media kinds the app layer knows how to render. */
export type MediaKind = "article" | "social" | "video" | "audio" | "live"

/** A person/account associated with an item (article byline, video channel, …). */
export interface MediaAuthor {
  name: string
  avatar?: string
  handle?: string
}

/** Delivery hint for a playable stream. */
export type StreamingFormat = "hls" | "dash" | "progressive"

/** Fields common to every media item variant. */
export interface MediaItemBase {
  /** Stable unique id within the source (the RSS guid / live roomId / …). */
  id: string
  /** Owning subscription. Items are joined to config by this. */
  subscriptionId: string
  /** Identifier of the originating source adapter (e.g. "rss", "live:bilibili"). */
  sourceId: string
  kind: MediaKind
  title: string
  url?: string
  summary?: string
  thumbnail?: string
  author?: MediaAuthor
  /** Unix epoch ms. Omitted when a source provides no usable timestamp. */
  publishedAt?: number
  /** Unix epoch ms — when the data layer fetched this item. */
  fetchedAt: number
  /** User-facing state. Defaults to true on fresh items; cleared on read. */
  isUnread?: boolean
  isStarred?: boolean
  /** Opaque source payload, kept for lossless round-trip / future mapping. */
  raw?: unknown

  // ── Rendering / playback hints (see docs/technical-plan.md) ──────────────
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

/** Long-form text content (blog post, news article, RSS `<item>`). */
export interface ArticleItem extends MediaItemBase {
  kind: "article"
  content?: string
  contentFormat?: "html" | "markdown" | "text"
  /** Media attachments extracted from the source (enclosure / media:content / itunes). */
  media?: MediaAttachment[]
}

/** Short-form social post (tweet-like, with reactions). */
export interface SocialItem extends MediaItemBase {
  kind: "social"
  content: string
  images?: string[]
  likes?: number
  reposts?: number
  replies?: number
  isLiked?: boolean
}

/** A playable stream plus its delivery hints (format, headers). */
export interface MediaStream {
  url: string
  format?: string
  headers?: Record<string, string>
}

/**
 * A media *attachment* inside an article (`ArticleItem.media[]`).
 *
 * Distinct from the top-level `MediaItem` union: an attachment is a single
 * embeddable resource (image / video / audio / live), and images are allowed
 * here even though there is no standalone `image` *item* kind.
 */
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

/** A hosted video clip (VOD). Distinct from a live stream — see `LiveItem`. */
export interface VideoItem extends MediaItemBase {
  kind: "video"
  duration?: number
  stream?: MediaStream
  channel?: { name: string; avatar?: string }
}

/** A hosted audio clip (podcast / music). Distinct from a live stream. */
export interface AudioItem extends MediaItemBase {
  kind: "audio"
  duration?: number
  artist?: string
  album?: string
  stream?: MediaStream
}

/** Live-stream liveness, as resolved at refresh time. */
export type LiveStatus = "live" | "offline" | "unknown"

/** Supported live platforms (mirrors dart_simple_live's four sites). */
export type LivePlatformId = "bilibili" | "douyu" | "huya" | "douyin"

/**
 * A live room surfaced as a media item.
 *
 * Scope: status + metadata only at refresh time. `playUrls` are resolved on
 * demand via `DataLayer.resolveLivePlay()` because they expire and require a
 * multi-step resolve — not part of the periodic refresh.
 */
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
  /** Populated lazily by `resolveLivePlay()`. */
  playUrls?: string[]
  playHeaders?: Record<string, string>
  quality?: string
}

export type MediaItem =
  | ArticleItem
  | SocialItem
  | VideoItem
  | AudioItem
  | LiveItem
