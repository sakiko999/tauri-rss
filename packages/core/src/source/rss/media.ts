/**
 * Media extraction — pulls embeddable media out of a parsed RSS/Atom item.
 *
 * Handles the common "media" fields across RSS flavors:
 *   - RSS 2.0 `<enclosure url type length>`
 *   - `<media:content>` / `<media:group>` / `<media:thumbnail>` (MRSS)
 *   - `<itunes:image>` / `<itunes:duration>`
 *   - Atom `<link rel="enclosure" type length>`
 *   - A plain `<image>` child (some feeds)
 *
 * Output is `MediaAttachment[]` — the embedded-resource list that `ArticleItem.media`
 * carries. Type is inferred from the MIME `type` attr; failing that, from the URL
 * extension.
 */
import type {
  MediaAttachment,
  MediaAttachmentKind,
} from "../../types/media-item.ts"
import type { ParsedItem } from "./xml-parser.ts"

export interface ExtractMediaOptions {
  /** Derive aspectRatio from width/height when both present. */
  computeAspectRatio?: boolean
}

/** Extract media attachments from a parsed item. Returns [] when none. */
export function extractMedia(item: ParsedItem, opts: ExtractMediaOptions = {}): MediaAttachment[] {
  const raw = item.raw
  if (!raw) return []

  const out: MediaAttachment[] = []
  const push = (att: MediaAttachment) => {
    if (att.url) out.push(att)
  }

  // RSS 2.0 <enclosure> — may be one or an array.
  for (const enc of asArray(raw.enclosure)) {
    const o = asObj(enc)
    if (!o) continue
    push(
      mediaAttachment({
        url: attr(o, "url"),
        mimeType: attr(o, "type"),
        title: attr(o, "title") ?? item.title,
        length: attr(o, "length"),
      }, opts),
    )
  }

  // MRSS <media:group> / <media:content> / <media:thumbnail>
  const group = raw["media:group"]
  if (group) {
    for (const mc of asArray((asObj(group) ?? {})["media:content"])) {
      const o = asObj(mc)
      if (!o) continue
      push(
        mediaAttachment({
          url: attr(o, "url"),
          mimeType: attr(o, "type"),
          title: attr(o, "medium") === "image" ? item.title : attr(o, "title") ?? item.title,
          poster: asPoster(o),
        }, opts),
      )
    }
    for (const mt of asArray((asObj(group) ?? {})["media:thumbnail"])) {
      const o = asObj(mt)
      if (!o) continue
      push(
        mediaAttachment({
          url: attr(o, "url"),
          mimeType: "image",
          width: intAttr(o, "width"),
          height: intAttr(o, "height"),
        }, opts),
      )
    }
  }
  for (const mc of asArray(raw["media:content"])) {
    const o = asObj(mc)
    if (!o) continue
    push(
      mediaAttachment({
        url: attr(o, "url"),
        mimeType: attr(o, "type"),
        title: attr(o, "title") ?? item.title,
        poster: asPoster(o),
        width: intAttr(o, "width"),
        height: intAttr(o, "height"),
      }, opts),
    )
  }
  for (const mt of asArray(raw["media:thumbnail"])) {
    const o = asObj(mt)
    if (!o) continue
    push(
      mediaAttachment({
        url: attr(o, "url"),
        mimeType: "image",
        width: intAttr(o, "width"),
        height: intAttr(o, "height"),
      }, opts),
    )
  }

  // itunes:image / itunes:duration (podcast)
  const itunesImg = raw["itunes:image"]
  const itunesImgObj = asObj(itunesImg)
  if (itunesImgObj) {
    push(mediaAttachment({ url: attr(itunesImgObj, "href"), mimeType: "image" }, opts))
  }
  // itunes:duration applies to the audio attachment (the enclosure), not the last item.
  const itunesDur = asString(raw["itunes:duration"])
  if (itunesDur) {
    const audio = out.find((m) => m.kind === "audio")
    if (audio) audio.durationSec = parseDurationSec(itunesDur)
  }

  // Atom <link rel="enclosure" type length>
  for (const link of asArray(raw.link)) {
    const o = asObj(link)
    if (o && attr(o, "rel") === "enclosure") {
      push(
        mediaAttachment({
          url: attr(o, "href"),
          mimeType: attr(o, "type"),
          title: item.title,
          length: attr(o, "length"),
        }, opts),
      )
    }
  }

  // Plain <image> child (rare; RSS 2.0 item image)
  const plainImg = asObj(raw.image)
  if (plainImg) {
    push(mediaAttachment({ url: attr(plainImg, "url") ?? asString(plainImg.url), mimeType: "image" }, opts))
  }

  return dedupe(out)
}

function mediaAttachment(fields: {
  url?: string
  mimeType?: string
  title?: string
  poster?: string
  width?: number
  height?: number
  length?: string
}, opts: ExtractMediaOptions): MediaAttachment {
  const kind = inferKind(fields.mimeType, fields.url)
  const att: MediaAttachment = {
    kind,
    url: fields.url ?? "",
    title: fields.title,
    mimeType: fields.mimeType,
    poster: fields.poster,
    width: fields.width,
    height: fields.height,
  }
  if (kind === "video" || kind === "audio") {
    if (fields.mimeType?.includes("mpegurl") || fields.url?.includes(".m3u8")) {
      att.streamingFormat = "hls"
    } else if (fields.mimeType?.includes("mpd") || fields.url?.includes(".mpd")) {
      att.streamingFormat = "dash"
    } else if (isProgressive(fields.url)) {
      att.streamingFormat = "progressive"
    }
  }
  if (opts.computeAspectRatio && fields.width && fields.height && fields.height > 0) {
    att.aspectRatio = fields.width / fields.height
  }
  return att
}

function inferKind(mimeType?: string, url?: string): MediaAttachmentKind {
  if (mimeType) {
    if (mimeType.startsWith("video/")) return "video"
    if (mimeType.startsWith("audio/")) return "audio"
    if (mimeType.startsWith("image/")) return "image"
  }
  if (url) {
    const ext = (url.split("?")[0] ?? url).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
    if (ext) {
      if (["jpg", "jpeg", "png", "gif", "webp", "avif", "svg", "bmp"].includes(ext)) return "image"
      if (["mp4", "webm", "mov", "mkv", "m4v", "ogv"].includes(ext)) return "video"
      if (["mp3", "m4a", "wav", "ogg", "opus", "flac", "aac", "wma"].includes(ext)) return "audio"
    }
  }
  return "image" // least surprising default for an unknown attachment
}

function isProgressive(url?: string): boolean {
  if (!url) return false
  const ext = (url.split("?")[0] ?? url).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  return ["mp4", "webm", "mp3", "m4a", "wav", "ogg"].includes(ext ?? "")
}

/** iTunes duration: "HH:MM:SS", "MM:SS", or plain seconds → seconds. */
function parseDurationSec(s: string): number | undefined {
  if (/^\d+$/.test(s.trim())) return Number(s.trim())
  const parts = s.trim().split(":").map(Number)
  if (parts.some((n) => Number.isNaN(n))) return undefined
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!
  return undefined
}

function asPoster(o: Record<string, unknown>): string | undefined {
  // <media:content> can carry <media:thumbnail> child for the poster
  const thumbs = asArray(o["media:thumbnail"])
  for (const t of thumbs) {
    const url = attr(asObj(t) ?? {}, "url")
    if (url) return url
  }
  const img = asObj(o["media:image"])
  if (img) {
    const url = attr(img, "url") ?? asString(img.url)
    if (url) return url
  }
  return undefined
}

// ── small helpers ────────────────────────────────────────────────────────────

function asArray(v: unknown): unknown[] {
  if (v === undefined || v === null) return []
  return Array.isArray(v) ? v : [v]
}

function asObj(v: unknown): Record<string, unknown> | undefined {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>
  return undefined
}

function attr(o: Record<string, unknown>, name: string): string | undefined {
  const v = o[`@_${name}`]
  if (typeof v === "string") return v
  return undefined
}

function intAttr(o: Record<string, unknown>, name: string): number | undefined {
  const v = attr(o, name)
  if (v === undefined) return undefined
  const n = Number.parseInt(v, 10)
  return Number.isNaN(n) ? undefined : n
}

function asString(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v === "string") return v
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  return undefined
}

function dedupe(list: MediaAttachment[]): MediaAttachment[] {
  const seen = new Set<string>()
  return list.filter((a) => {
    const key = `${a.kind}:${a.url}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
