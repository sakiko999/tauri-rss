/**
 * Map a parsed feed into `ArticleItem[]`.
 *
 * Each item carries its extracted media attachments (`media[]`) via
 * `source/rss/media.ts`. Drop the rss-reader baggage the new model doesn't need:
 * avatar/icon/color generation (no avatar on `ArticleItem`), time formatting
 * (publishedAt is epoch ms; formatting is app-layer), random fallback ids
 * (use guid or url-hash).
 */
import type { ArticleItem, MediaAuthor } from "../../types/media-item.ts"
import type { ParsedFeed, ParsedItem } from "./xml-parser.ts"
import { extractMedia } from "./media.ts"

export interface MapOptions {
  /** Owning subscription id, stamped onto every item. */
  subscriptionId: string
  /** Source adapter id (e.g. "rss"). */
  sourceId: string
  /** Epoch ms at fetch time. */
  fetchedAt: number
  /** Channel title, used as author fallback / source name. */
  feedTitle?: string
}

export function feedToArticles(feed: ParsedFeed, opts: MapOptions): ArticleItem[] {
  return feed.channel.item.map((it) => itemToArticle(it, opts))
}

function itemToArticle(item: ParsedItem, opts: MapOptions): ArticleItem {
  const title = item.title ?? "(untitled)"
  const summary = item.description
  const content = item.content ?? item.description
  const publishedAt = parseDateMs(item.pubDate)
  const author = toAuthor(item.author, opts.feedTitle)
  const media = extractMedia(item, { computeAspectRatio: true })
  const thumb = firstImage(media) ?? undefined

  return {
    id: item.guid ?? `hash-${hashString(item.link ?? title)}`,
    subscriptionId: opts.subscriptionId,
    sourceId: opts.sourceId,
    kind: "article",
    title,
    url: item.link,
    summary,
    thumbnail: thumb,
    content,
    contentFormat: content ? "html" : undefined,
    author,
    publishedAt,
    fetchedAt: opts.fetchedAt,
    isUnread: true,
    media: media.length ? media : undefined,
    raw: item,
  }
}

/** First image attachment, used as the list thumbnail. */
function firstImage(media: ReturnType<typeof extractMedia>): string | undefined {
  for (const m of media) {
    if (m.kind === "image") return m.url
  }
  return media[0]?.poster
}

function toAuthor(authorName: string | undefined, feedTitle?: string): MediaAuthor | undefined {
  if (authorName && authorName.trim()) return { name: authorName.trim() }
  if (feedTitle && feedTitle.trim()) return { name: feedTitle.trim() }
  return undefined
}

function parseDateMs(pubDate?: string): number | undefined {
  if (!pubDate) return undefined
  const ms = new Date(pubDate).getTime()
  return Number.isNaN(ms) ? undefined : ms
}

/** Deterministic non-crypto hash (FNV-1a) — stable id fallback for items lacking guid. */
function hashString(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}
