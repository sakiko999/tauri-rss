/**
 * FeedSerializer — `FeedItem[]` → RSS 2.0 XML string.
 *
 * The "producer as a minimal RSSHub" boundary: this package emits standard RSS
 * so downstream (and any standard RSS reader) consumes only links + XML.
 * Standard readers get the standard subset (title/link/description/guid/
 * pubDate/enclosure/author); the project's own `feed-deserializer` recovers the
 * full `FeedItem` via the private `tpl:` namespace extension.
 *
 * `tpl:` is a namespace extension in the same spirit as Media RSS / iTunes —
 * RSS readers ignore unknown-prefixed nodes cleanly, so emitting extra live
 * fields never breaks standard consumption. Only `serializeFeed` produces
 * `tpl:`; it round-trips through `deserializeFeed` losslessly for every field
 * except the opaque `raw` payload, which XML cannot represent.
 */
import type { FeedItem, FeedItemBase } from "../types/feed-item.ts"

export interface SerializeOptions {
  channelTitle?: string
  channelLink?: string
  channelDescription?: string
}

const NS = 'xmlns:tpl="https://tauri-playground.local/ns/tpl" xmlns:content="http://purl.org/rss/1.0/modules/content/"'

export function serializeFeed(items: FeedItem[], opts: SerializeOptions = {}): string {
  const parts: string[] = []
  parts.push('<?xml version="1.0" encoding="UTF-8"?>')
  parts.push(`<rss version="2.0" ${NS}>`)
  parts.push("<channel>")
  if (opts.channelTitle) parts.push(`<title>${esc(opts.channelTitle)}</title>`)
  if (opts.channelLink) parts.push(`<link>${esc(opts.channelLink)}</link>`)
  if (opts.channelDescription) parts.push(`<description>${esc(opts.channelDescription)}</description>`)
  for (const item of items) parts.push(serializeItem(item))
  parts.push("</channel>")
  parts.push("</rss>")
  return parts.join("")
}

// ── item serialization ───────────────────────────────────────────────────────

function serializeItem(item: FeedItem): string {
  const p: string[] = []
  p.push("<item>")
  push(p, "title", item.title)
  if (item.url) push(p, "link", item.url)
  if (item.summary) p.push(`<description>${wrapCdata(item.summary)}</description>`)
  if ((item.kind === "article" || item.kind === "social") && item.content) {
    p.push(`<content:encoded>${wrapCdata(item.content)}</content:encoded>`)
  }
  p.push(`<guid isPermaLink="false">${esc(item.id)}</guid>`)
  if (item.publishedAt !== undefined) p.push(`<pubDate>${toRfc822(item.publishedAt)}</pubDate>`)
  if (item.author?.name) push(p, "author", item.author.name)
  // Single primary video/audio attachment becomes a standard enclosure so a
  // standard reader sees a playable resource.
  const enc = enclosure(item)
  if (enc) p.push(`<enclosure url="${esc(enc.url)}" type="${esc(enc.type ?? "")}"/>`)

  // tpl: extension — recover the full model. `subscriptionId` is app-layer
  // semantics owned by core, not part of the feed protocol.
  push(p, "tpl:sourceId", item.sourceId)
  push(p, "tpl:kind", item.kind)
  push(p, "tpl:fetchedAt", String(item.fetchedAt))
  if (item.isUnread !== undefined) push(p, "tpl:isUnread", item.isUnread ? "1" : "0")
  if (item.isStarred !== undefined) push(p, "tpl:isStarred", item.isStarred ? "1" : "0")
  if (item.summary !== undefined) push(p, "tpl:summary", item.summary)
  if (item.thumbnail) push(p, "tpl:thumbnail", item.thumbnail)
  if (item.author?.name) push(p, "tpl:authorName", item.author.name)
  if (item.author?.avatar) push(p, "tpl:authorAvatar", item.author.avatar)
  if (item.author?.handle) push(p, "tpl:authorHandle", item.author.handle)
  pushPrimitives(p, item)
  pushKindSpecific(p, item)

  p.push("</item>")
  return p.join("")
}

/** Base playback/rendering hints shared across kinds. */
function pushPrimitives(p: string[], item: FeedItemBase): void {
  if (item.mimeType) push(p, "tpl:mimeType", item.mimeType)
  if (item.poster) push(p, "tpl:poster", item.poster)
  if (item.width !== undefined) push(p, "tpl:width", String(item.width))
  if (item.height !== undefined) push(p, "tpl:height", String(item.height))
  if (item.aspectRatio !== undefined) push(p, "tpl:aspectRatio", String(item.aspectRatio))
  if (item.durationSec !== undefined) push(p, "tpl:durationSec", String(item.durationSec))
  if (item.bitrate !== undefined) push(p, "tpl:bitrate", String(item.bitrate))
  if (item.streamingFormat) push(p, "tpl:streamingFormat", item.streamingFormat)
  if (item.isLiveNow !== undefined) push(p, "tpl:isLiveNow", item.isLiveNow ? "1" : "0")
  if (item.lang) push(p, "tpl:lang", item.lang)
}

function pushKindSpecific(p: string[], item: FeedItem): void {
  switch (item.kind) {
    case "article": {
      if (item.contentFormat) push(p, "tpl:contentFormat", item.contentFormat)
      for (const m of item.media ?? []) {
        const attrs = [`kind="${m.kind}"`, `url="${esc(m.url)}"`]
        if (m.title) attrs.push(`title="${esc(m.title)}"`)
        if (m.mimeType) attrs.push(`mimeType="${esc(m.mimeType)}"`)
        if (m.poster) attrs.push(`poster="${esc(m.poster)}"`)
        if (m.width !== undefined) attrs.push(`width="${m.width}"`)
        if (m.height !== undefined) attrs.push(`height="${m.height}"`)
        if (m.aspectRatio !== undefined) attrs.push(`aspectRatio="${m.aspectRatio}"`)
        if (m.durationSec !== undefined) attrs.push(`durationSec="${m.durationSec}"`)
        if (m.bitrate !== undefined) attrs.push(`bitrate="${m.bitrate}"`)
        if (m.streamingFormat) attrs.push(`streamingFormat="${m.streamingFormat}"`)
        if (m.isLiveNow !== undefined) attrs.push(`isLiveNow="${m.isLiveNow ? 1 : 0}"`)
        if (m.lang) attrs.push(`lang="${m.lang}"`)
        p.push(`<tpl:media ${attrs.join(" ")}/>`)
      }
      break
    }
    case "social": {
      if (item.images?.length) {
        p.push(`<tpl:images>${item.images.map((u) => `<tpl:image>${esc(u)}</tpl:image>`).join("")}</tpl:images>`)
      }
      if (item.likes !== undefined) push(p, "tpl:likes", String(item.likes))
      if (item.reposts !== undefined) push(p, "tpl:reposts", String(item.reposts))
      if (item.replies !== undefined) push(p, "tpl:replies", String(item.replies))
      if (item.isLiked !== undefined) push(p, "tpl:isLiked", item.isLiked ? "1" : "0")
      break
    }
    case "video": {
      if (item.duration !== undefined) push(p, "tpl:duration", String(item.duration))
      if (item.stream) p.push(streamXml(item.stream))
      if (item.channel?.name) push(p, "tpl:channelName", item.channel.name)
      if (item.channel?.avatar) push(p, "tpl:channelAvatar", item.channel.avatar)
      break
    }
    case "audio": {
      if (item.duration !== undefined) push(p, "tpl:duration", String(item.duration))
      if (item.artist) push(p, "tpl:artist", item.artist)
      if (item.album) push(p, "tpl:album", item.album)
      if (item.stream) p.push(streamXml(item.stream))
      break
    }
    case "live": {
      push(p, "tpl:platform", item.platform)
      push(p, "tpl:roomId", item.roomId)
      push(p, "tpl:liveStatus", item.liveStatus)
      if (item.online !== undefined) push(p, "tpl:online", String(item.online))
      if (item.isRecord !== undefined) push(p, "tpl:isRecord", item.isRecord ? "1" : "0")
      if (item.introduction !== undefined) push(p, "tpl:introduction", item.introduction)
      if (item.notice !== undefined) push(p, "tpl:notice", item.notice)
      if (item.showTime !== undefined) push(p, "tpl:showTime", item.showTime)
      if (item.playUrls?.length || item.playHeaders || item.quality || item.playUrlsExpiresAt !== undefined) {
        p.push(livePlayXml(item))
      }
      break
    }
  }
}

function streamXml(s: { url: string; format?: string; headers?: Record<string, string> }): string {
  const attrs = [`url="${esc(s.url)}"`]
  if (s.format) attrs.push(`format="${esc(s.format)}"`)
  const open = `<tpl:stream ${attrs.join(" ")}>`
  if (s.headers && Object.keys(s.headers).length) {
    const headers = Object.entries(s.headers)
      .map(([k, v]) => `<tpl:header name="${esc(k)}">${esc(v)}</tpl:header>`)
      .join("")
    return `${open}<tpl:streamHeaders>${headers}</tpl:streamHeaders></tpl:stream>`
  }
  return `${open}</tpl:stream>`
}

function livePlayXml(item: Extract<FeedItem, { kind: "live" }>): string {
  const attrs = item.playUrlsExpiresAt !== undefined ? ` expiresAt="${item.playUrlsExpiresAt}"` : ""
  const plays = (item.playUrls ?? [])
    .map((u) => `<tpl:play url="${esc(u)}"/>`)
    .join("")
  let headers = ""
  if (item.playHeaders && Object.keys(item.playHeaders).length) {
    const h = Object.entries(item.playHeaders)
      .map(([k, v]) => `<tpl:header name="${esc(k)}">${esc(v)}</tpl:header>`)
      .join("")
    headers = `<tpl:playHeaders>${h}</tpl:playHeaders>`
  }
  const quality = item.quality ? `<tpl:quality>${esc(item.quality)}</tpl:quality>` : ""
  return `<tpl:playUrls${attrs}>${plays}${headers}${quality}</tpl:playUrls>`
}

/** First playable (video/audio) attachment → standard enclosure. */
function enclosure(item: FeedItem): { url: string; type?: string } | undefined {
  if (item.kind !== "article") return undefined
  for (const m of item.media ?? []) {
    if (m.kind === "video" || m.kind === "audio") return { url: m.url, type: m.mimeType }
  }
  return undefined
}

// ── helpers ──────────────────────────────────────────────────────────────────

function push(p: string[], tag: string, value: string): void {
  p.push(`<${tag}>${esc(value)}</${tag}>`)
}

/** Escape XML text content (attribute & text). CDATA content is NOT re-escaped. */
function esc(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

/** Wrap arbitrary HTML/plain text in CDATA, splitting the `]]>` terminator. */
function wrapCdata(s: string): string {
  const safe = s.replace(/\]\]>/g, "]]]]><![CDATA[>")
  return `<![CDATA[${safe}]]>`
}

/** Epoch ms → RFC 822 (RFC 1123) — the format RSS pubDate uses. */
function toRfc822(ms: number): string {
  const d = new Date(ms)
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ]
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    `${days[d.getUTCDay()]}, ${pad(d.getUTCDate())} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} GMT`
  )
}