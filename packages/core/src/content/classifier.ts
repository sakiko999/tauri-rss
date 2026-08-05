/**
 * Content classifier — decides the primary `Content` kind of a feed item
 * from its extracted media attachments.
 *
 * Rule: if an item has exactly one primary playable attachment (video/audio)
 * and no substantial text body, classify it as that kind. Otherwise it's an
 * article (text is primary; media stays in `media[]`). Live streams map to
 * `live`. Social posts map to `social`.
 */
import type { ArticleItem, MediaAttachment, MediaItem } from "../types/media-item.ts"
import type { Content } from "../types/content.ts"

export interface ClassifierOptions {
  /** Item body is considered "substantial" above this char count. */
  textThreshold?: number
}

/** Infer the primary `Content` for an article-shaped item. */
export function inferContent(item: ArticleItem, opts: ClassifierOptions = {}): Content {
  const threshold = opts.textThreshold ?? 200
  const media = item.media ?? []
  const playables = media.filter((m) => m.kind === "video" || m.kind === "audio")
  const bodyLen = (item.content ?? item.summary ?? "").length

  // A standalone playable with a thin body → that kind.
  if (playables.length > 0 && bodyLen < threshold) {
    const primary = playables[0]!
    if (primary.kind === "video") {
      return { kind: "video", video: toMediaItem(primary, item), media }
    }
    if (primary.kind === "audio") {
      return { kind: "audio", audio: toMediaItem(primary, item), media }
    }
  }

  // Live items are their own content kind.
  const live = media.find((m) => m.kind === "live")
  if (live) {
    return { kind: "live", stream: toMediaItem(live, item), media }
  }

  return { kind: "article", media }
}

/** For a social post item (already a `SocialItem`), produce its `Content`. */
export function socialContent(item: { kind: "social"; media?: MediaAttachment[] }): Content {
  return { kind: "social", media: item.media }
}

/** For a top-level `MediaItem`, produce its `Content`. */
export function classifyMediaItem(item: MediaItem): Content {
  switch (item.kind) {
    case "article":
      return inferContent(item)
    case "social":
      return socialContent(item)
    case "video":
      return { kind: "video", video: item }
    case "audio":
      return { kind: "audio", audio: item }
    case "live":
      return { kind: "live", stream: item }
  }
}

/** Promote an attachment to a top-level `MediaItem` for the `video/audio/stream` slot. */
function toMediaItem(att: MediaAttachment, parent: ArticleItem): MediaItem {
  const base = {
    id: parent.id,
    subscriptionId: parent.subscriptionId,
    sourceId: parent.sourceId,
    title: att.title ?? parent.title,
    url: att.url,
    summary: parent.summary,
    thumbnail: att.poster ?? parent.thumbnail,
    author: parent.author,
    publishedAt: parent.publishedAt,
    fetchedAt: parent.fetchedAt,
    isUnread: parent.isUnread,
    isStarred: parent.isStarred,
    mimeType: att.mimeType,
    poster: att.poster,
    aspectRatio: att.aspectRatio,
    durationSec: att.durationSec,
    bitrate: att.bitrate,
    streamingFormat: att.streamingFormat,
    isLiveNow: att.isLiveNow,
    lang: att.lang,
    raw: parent.raw,
  }
  if (att.kind === "video") {
    return { ...base, kind: "video", stream: { url: att.url, format: att.streamingFormat } }
  }
  if (att.kind === "audio") {
    return { ...base, kind: "audio", stream: { url: att.url, format: att.streamingFormat } }
  }
  // live / image fall back to an article (images aren't items)
  return { ...base, kind: "article", media: [att] }
}
