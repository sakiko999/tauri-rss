/**
 * Content model — the classifier output the app layer renders.
 *
 * A `Content` is a discriminated union keyed on `kind` describing *what a
 * feed item primarily is*. The classifier (`content/classifier.ts`) decides
 * this from an item's text + extracted `media[]` attachments.
 *
 * - `article` — a long-form text item (may carry `media[]` attachments)
 * - `video`   — an item whose primary payload is a video clip
 * - `audio`   — an item whose primary payload is an audio clip (podcast)
 * - `live`    — a live stream room
 * - `social`  — a short-form post
 */
import type { MediaAttachment, MediaItem } from "@tauri-playground/producer"

export type ContentKind = "article" | "video" | "audio" | "live" | "social"

/** The payload a renderer needs per kind. `media` is the raw attachment list. */
export type Content =
  | { kind: "article"; media?: MediaAttachment[] }
  | { kind: "video"; video: MediaItem; media?: MediaAttachment[] }
  | { kind: "audio"; audio: MediaItem; media?: MediaAttachment[] }
  | { kind: "live"; stream: MediaItem; media?: MediaAttachment[] }
  | { kind: "social"; media?: MediaAttachment[] }

/** A feed subscription's own metadata (distinct from a `FeedItem`). */
export interface Feed {
  id: string // stable hash(url)
  url: string
  siteUrl?: string
  title: string
  description?: string
  favicon?: string
  kind: ContentKind | "mixed"
  lastFetchedAt?: number
  etag?: string
  lastModified?: string
  lastError?: string
  folderId?: string
  createdAt: number
}

/** A single entry fetched from a feed. */
export interface FeedItem {
  id: string // stable hash(feedId + guid/link)
  feedId: string
  guid?: string
  title: string
  summary?: string
  content?: string // 原始 HTML，渲染前 sanitize
  link?: string
  author?: string
  publishedAt: number
  updatedAt?: number
  tags: string[]
  media: MediaAttachment[] // raw attachments (enclosure / media:content / itunes)
  /** Classifier output — what kind this item primarily renders as. */
  classification: Content
}
