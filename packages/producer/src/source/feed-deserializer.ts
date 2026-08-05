/**
 * FeedDeserializer — RSS 2.0 (+ `tpl:` extension) XML → `FeedItem[]`.
 *
 * Purpose: the exact inverse of `serializeFeed`, recovering the *full*
 * `FeedItem` protocol model from XML the project itself emitted. It reuses the
 * generic `parseFeed` (xml-parser.ts) unchanged — that parser already preserves
 * the entire node tree in `ParsedItem.raw` (with attributes under `@_`), so all
 * `tpl:*` fields are reachable without modifying the generic parser.
 *
 * Scope: **project-originated XML only.** A third-party standard reader that
 * re-emits the feed will drop the `tpl:` namespace, so a foreign feed with no
 * `tpl:*` degrades to a plain `FeedArticle` with default state — that's a
 * downstream information loss, not a parser bug.
 */
import type { FeedItem, FeedLivePlatformId, FeedLiveStatus } from "../types/feed-item.ts"
import type { FeedAttachment, FeedAuthor, FeedStreamingFormat } from "../types/feed-item.ts"
import { parseFeed, type ParsedItem } from "../parse/xml-parser.ts"

/** `FeedStreamingFormat` is a closed union; unknown values degrade to undefined. */
function asStreamingFormat(v: unknown): FeedStreamingFormat | undefined {
  const s = str(v)
  if (s === "hls" || s === "dash" || s === "progressive") return s
  return undefined
}

/** `FeedArticle.contentFormat` is a closed union; unknown values degrade to undefined. */
function asContentFormat(v: unknown): "html" | "markdown" | "text" | undefined {
  const s = str(v)
  if (s === "html" || s === "markdown" || s === "text") return s
  return undefined
}

export function deserializeFeed(xml: string): FeedItem[] {
  const feed = parseFeed(xml)
  const now = Date.now()
  return feed.channel.item.map((it) => {
    const kind = str(it.raw?.["tpl:kind"]) ?? "article"
    switch (kind) {
      case "social":
        return parseSocial(it, now)
      case "video":
        return parseVideo(it, now)
      case "audio":
        return parseAudio(it, now)
      case "live":
        return parseLive(it, now)
      case "article":
      default:
        return parseArticle(it, now)
    }
  })
}

// ── shared base reconstruction ───────────────────────────────────────────────

function baseFields(it: ParsedItem, now: number) {
  const raw = it.raw ?? {}
  const author = toAuthor({
    name: str(raw["tpl:authorName"]) ?? it.author,
    avatar: str(raw["tpl:authorAvatar"]),
    handle: str(raw["tpl:authorHandle"]),
  })
  return {
    id: it.guid ?? `hash-${it.title ?? ""}`,
    sourceId: str(raw["tpl:sourceId"]) ?? "rss",
    title: it.title ?? "(untitled)",
    url: it.link,
    summary: str(raw["tpl:summary"]) ?? it.description,
    thumbnail: str(raw["tpl:thumbnail"]),
    author,
    publishedAt: it.pubDate ? tryEpoch(it.pubDate) : undefined,
    fetchedAt: num(raw["tpl:fetchedAt"]) ?? now,
    isUnread: boolTpl(raw["tpl:isUnread"], undefined),
    isStarred: boolTpl(raw["tpl:isStarred"], undefined),
    mimeType: str(raw["tpl:mimeType"]),
    poster: str(raw["tpl:poster"]),
    width: num(raw["tpl:width"]),
    height: num(raw["tpl:height"]),
    aspectRatio: num(raw["tpl:aspectRatio"]),
    durationSec: num(raw["tpl:durationSec"]),
    bitrate: num(raw["tpl:bitrate"]),
    streamingFormat: asStreamingFormat(raw["tpl:streamingFormat"]),
    isLiveNow: boolTpl(raw["tpl:isLiveNow"], undefined),
    lang: str(raw["tpl:lang"]),
  }
}

function parseArticle(it: ParsedItem, now: number): FeedItem {
  const b = baseFields(it, now)
  const raw = it.raw ?? {}
  return {
    ...b,
    kind: "article",
    content: it.content ?? it.description,
    contentFormat: asContentFormat(raw["tpl:contentFormat"]) ?? (it.content ? "html" : undefined),
    media: parseMedia(raw),
  }
}

function parseSocial(it: ParsedItem, now: number): FeedItem {
  const b = baseFields(it, now)
  const raw = it.raw ?? {}
  return {
    ...b,
    kind: "social",
    content: it.content ?? it.description ?? "",
    images: parseImages(raw["tpl:images"]),
    likes: num(raw["tpl:likes"]),
    reposts: num(raw["tpl:reposts"]),
    replies: num(raw["tpl:replies"]),
    isLiked: boolTpl(raw["tpl:isLiked"], undefined),
  }
}

function parseVideo(it: ParsedItem, now: number): FeedItem {
  const b = baseFields(it, now)
  const raw = it.raw ?? {}
  return {
    ...b,
    kind: "video",
    duration: num(raw["tpl:duration"]) as number | undefined,
    stream: parseStream(raw["tpl:stream"]),
    channel:
      str(raw["tpl:channelName"]) || str(raw["tpl:channelAvatar"])
        ? { name: str(raw["tpl:channelName"]) ?? "", avatar: str(raw["tpl:channelAvatar"]) }
        : undefined,
  }
}

function parseAudio(it: ParsedItem, now: number): FeedItem {
  const b = baseFields(it, now)
  const raw = it.raw ?? {}
  return {
    ...b,
    kind: "audio",
    duration: num(raw["tpl:duration"]) as number | undefined,
    artist: str(raw["tpl:artist"]),
    album: str(raw["tpl:album"]),
    stream: parseStream(raw["tpl:stream"]),
  }
}

function parseLive(it: ParsedItem, now: number): FeedItem {
  const b = baseFields(it, now)
  const raw = it.raw ?? {}
  const play = obj(raw["tpl:playUrls"])
  const playList = arr(play["tpl:play"])
    .map((o) => str(attr(o, "url")))
    .filter((v): v is string => !!v)
  return {
    ...b,
    kind: "live",
    platform: (str(raw["tpl:platform"]) as FeedLivePlatformId | undefined) ?? "bilibili",
    roomId: str(raw["tpl:roomId"]) ?? "",
    liveStatus: (str(raw["tpl:liveStatus"]) as FeedLiveStatus | undefined) ?? "unknown",
    online: num(raw["tpl:online"]),
    isRecord: boolTpl(raw["tpl:isRecord"], undefined),
    introduction: str(raw["tpl:introduction"]),
    notice: str(raw["tpl:notice"]),
    showTime: str(raw["tpl:showTime"]),
    playUrls: playList.length ? playList : undefined,
    playHeaders: parseHeaders(play["tpl:playHeaders"]),
    quality: str(play["tpl:quality"]),
    playUrlsExpiresAt: num(attr(play, "expiresAt")),
  }
}

// ── nested parsers ───────────────────────────────────────────────────────────

function parseMedia(raw: Record<string, unknown>): FeedAttachment[] | undefined {
  const nodes = arr(raw["tpl:media"])
  if (!nodes.length) return undefined
  return nodes
    .map((o): FeedAttachment | null => {
      const kind = str(attr(o, "kind"))
      const url = str(attr(o, "url"))
      if (!kind || !url) return null
      const att: FeedAttachment = {
        kind: kind as FeedAttachment["kind"],
        url,
        title: str(attr(o, "title")),
        mimeType: str(attr(o, "mimeType")),
        poster: str(attr(o, "poster")),
        width: num(attr(o, "width")),
        height: num(attr(o, "height")),
        aspectRatio: num(attr(o, "aspectRatio")),
        durationSec: num(attr(o, "durationSec")),
        bitrate: num(attr(o, "bitrate")),
        streamingFormat: asStreamingFormat(attr(o, "streamingFormat")),
        isLiveNow: bool(attr(o, "isLiveNow")),
        lang: str(attr(o, "lang")),
      }
      // strip undefined holes so deep-equal matches the source shape
      for (const k of Object.keys(att) as (keyof FeedAttachment)[]) {
        if (att[k] === undefined) delete att[k]
      }
      return att
    })
    .filter((m): m is FeedAttachment => m !== null)
}

function parseImages(node: unknown): string[] | undefined {
  const o = obj(node)
  const imgs = asList(o["tpl:image"])
    .map((x) => text(x))
    .filter((v): v is string => !!v)
  return imgs.length ? imgs : undefined
}

function parseStream(node: unknown): { url: string; format?: string; headers?: Record<string, string> } | undefined {
  const o = obj(node)
  const url = str(attr(o, "url"))
  if (!url) return undefined
  return {
    url,
    format: str(attr(o, "format")) as "hls" | "dash" | "progressive" | undefined,
    headers: parseHeaders(o["tpl:streamHeaders"]),
  }
}

function parseHeaders(node: unknown): Record<string, string> | undefined {
  const o = obj(node)
  const headers = arr(o["tpl:header"])
  if (!headers.length) return undefined
  const out: Record<string, string> = {}
  for (const h of headers) {
    const name = str(attr(h, "name"))
    const value = text(h)
    if (name && value !== undefined) out[name] = value
  }
  return Object.keys(out).length ? out : undefined
}

// ── helpers ──────────────────────────────────────────────────────────────────

function toAuthor(fields: {
  name?: string
  avatar?: string
  handle?: string
}): FeedAuthor | undefined {
  const name = fields.name?.trim()
  if (!name) return undefined
  return {
    name,
    avatar: fields.avatar || undefined,
    handle: fields.handle || undefined,
  }
}

/** Coerce an attribute object `{ "@_x": v }` to the `v` value. */
function attr(o: Record<string, unknown>, name: string): unknown {
  return o?.[`@_${name}`]
}

/** Extract the text of a node: string, `{ "#text" }`, or `{ "tpl:img" }`. */
function text(o: unknown): string | undefined {
  if (typeof o === "string") return o
  const obj_ = obj(o)
  return str(obj_["#text"]) ?? str(obj_)
}

/** Normalize a value to a list of raw nodes, keeping string children as-is. */
function asList(v: unknown): unknown[] {
  if (v === undefined || v === null) return []
  return Array.isArray(v) ? v : [v]
}

function obj(v: unknown): Record<string, unknown> {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>
  return {}
}

/** Coerce a value (possibly wrapped in `{ #text }`) to a string. */
function str(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v)
  if (typeof v === "object") {
    const o = v as Record<string, unknown>
    const t = o["#text"]
    if (t !== undefined) return str(t)
  }
  return undefined
}

function num(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v === "number") return v
  const s = str(v)
  if (s === undefined || s === "") return undefined
  const n = Number(s)
  return Number.isNaN(n) ? undefined : n
}

/** `tpl:isUnread=0|1`. `fallback` applies when the tpl field is absent. */
function boolTpl(v: unknown, fallback: boolean | undefined): boolean | undefined {
  if (v === undefined || v === null) return fallback
  return str(v) === "1"
}

/** Attribute-driven boolean (no fallback — `0|1` literal). */
function bool(v: unknown): boolean | undefined {
  if (v === undefined || v === null) return undefined
  return str(v) === "1"
}

function arr(v: unknown): Record<string, unknown>[] {
  if (v === undefined || v === null) return []
  const list = Array.isArray(v) ? v : [v]
  return list.map((x) => obj(x)).filter((o) => Object.keys(o).length > 0)
}

/** RFC 822 pubDate → epoch ms. */
function tryEpoch(s: string): number | undefined {
  const ms = new Date(s).getTime()
  return Number.isNaN(ms) ? undefined : ms
}
