/**
 * feed-to-media — bridge the producer's protocol `FeedItem` into core's render
 * model `MediaItem`.
 *
 * The producer emits `FeedItem[]` (no app-layer semantics) via
 * `SourceAdapter.fetch`. Core injects the app semantics here:
 *   - subscriptionId (from the refresh call)
 *   - isUnread ?? true  (fresh items start unread)
 *   - isStarred ?? false
 *   - fetchedAt ?? now
 * and copies every protocol field through. Live platform/status ids are the
 * same string literals on both sides (duck-typed), so no cast is needed.
 */
import type { FeedAttachment, FeedItem } from "@tauri-playground/producer"
import type {
  ArticleItem,
  AudioItem,
  LiveItem,
  MediaAttachment,
  MediaItem,
  MediaStream,
  SocialItem,
  VideoItem,
} from "./types/media-item.ts"

export interface FeedToMediaOptions {
  subscriptionId: string
  now: number
}

export function feedItemsToMediaItems(items: FeedItem[], opts: FeedToMediaOptions): MediaItem[] {
  return items.map((item) => mapItem(item, opts))
}

function mapItem(item: FeedItem, opts: FeedToMediaOptions): MediaItem {
  const base = {
    id: item.id,
    subscriptionId: opts.subscriptionId,
    sourceId: item.sourceId,
    title: item.title,
    url: item.url,
    summary: item.summary,
    thumbnail: item.thumbnail,
    author: item.author,
    publishedAt: item.publishedAt,
    fetchedAt: item.fetchedAt ?? opts.now,
    isUnread: item.isUnread ?? true,
    isStarred: item.isStarred ?? false,
    raw: item.raw,
    mimeType: item.mimeType,
    poster: item.poster,
    width: item.width,
    height: item.height,
    aspectRatio: item.aspectRatio,
    durationSec: item.durationSec,
    bitrate: item.bitrate,
    streamingFormat: item.streamingFormat,
    isLiveNow: item.isLiveNow,
    lang: item.lang,
  }
  switch (item.kind) {
    case "article": {
      const out: ArticleItem = { ...base, kind: "article" }
      if (item.content !== undefined) out.content = item.content
      if (item.contentFormat !== undefined) out.contentFormat = item.contentFormat
      if (item.media !== undefined) out.media = mapAttachments(item.media)
      return out
    }
    case "social": {
      const out: SocialItem = { ...base, kind: "social", content: item.content }
      if (item.images !== undefined) out.images = item.images
      if (item.likes !== undefined) out.likes = item.likes
      if (item.reposts !== undefined) out.reposts = item.reposts
      if (item.replies !== undefined) out.replies = item.replies
      if (item.isLiked !== undefined) out.isLiked = item.isLiked
      return out
    }
    case "video": {
      const out: VideoItem = { ...base, kind: "video" }
      if (item.duration !== undefined) out.duration = item.duration
      if (item.stream !== undefined) out.stream = mapStream(item.stream)
      if (item.channel !== undefined) out.channel = item.channel
      return out
    }
    case "audio": {
      const out: AudioItem = { ...base, kind: "audio" }
      if (item.duration !== undefined) out.duration = item.duration
      if (item.artist !== undefined) out.artist = item.artist
      if (item.album !== undefined) out.album = item.album
      if (item.stream !== undefined) out.stream = mapStream(item.stream)
      return out
    }
    case "live": {
      const out: LiveItem = { ...base, kind: "live", platform: item.platform, roomId: item.roomId, liveStatus: item.liveStatus }
      if (item.online !== undefined) out.online = item.online
      if (item.isRecord !== undefined) out.isRecord = item.isRecord
      if (item.introduction !== undefined) out.introduction = item.introduction
      if (item.notice !== undefined) out.notice = item.notice
      if (item.showTime !== undefined) out.showTime = item.showTime
      if (item.playUrls !== undefined) out.playUrls = item.playUrls
      if (item.playHeaders !== undefined) out.playHeaders = item.playHeaders
      if (item.quality !== undefined) out.quality = item.quality
      if (item.playUrlsExpiresAt !== undefined) out.playUrlsExpiresAt = item.playUrlsExpiresAt
      return out
    }
  }
}

function mapAttachments(list: FeedAttachment[]): MediaAttachment[] {
  return list.map((a) => ({ ...a }))
}

function mapStream(s: { url: string; format?: string; headers?: Record<string, string> }): MediaStream {
  return { url: s.url, format: s.format, headers: s.headers }
}
