/**
 * deserializeFeed — RSS 2.0(+ `tpl:` 扩展)XML → MediaItem[]。
 *
 * 是 crawler `serializeFeed` 的逆操作:从本项目自己发出的 XML 恢复完整渲染
 * 模型。复用通用 `parseFeed`(xml-parser.ts)——它保留整棵树在 `ParsedItem.raw`
 * (属性在 `@_` 下),所有 `tpl:*` 字段无需改解析器即可读回。
 *
 * app 层语义由 core 注入:subscriptionId 来自 ctx,isUnread 默认 true、
 * isStarred 默认 false(crawler Item 不携带这两个字段)。
 *
 * 范围:仅本项目产出的 XML。第三方标准阅读器重发的 feed 会丢 `tpl:` 命名空间,
 * 退化为纯 `ArticleItem` 默认态——这是下游信息损失,不是解析器 bug。
 */
import * as R from "ramda"
import type { MediaAttachment, MediaAuthor, MediaItem, MediaKind, MediaStream, SocialImage, StreamingFormat } from "../types/media-item.ts"
import type { LivePlatformId, LiveStatus } from "../types/live.ts"
import { parseFeed, type ParsedItem } from "@tauri-playground/xml"

/** 反序列化上下文:app 层语义由调用方注入。 */
export interface DeserializeContext {
  subscriptionId: string
  now: number
  /** channel 声明的默认 kind;item 自身 tpl:kind 优先。 */
  kind?: MediaKind
}

export function deserializeFeed(xml: string, ctx: DeserializeContext): MediaItem[] {
  return deserializeFeedWithTotal(xml, ctx).items
}

/** 反序列化 + 渠道真实总数(一次 parseFeed 双产出)。翻页渠道(weibo cardlistInfo.total
 * 经 tpl:total 带出)在 refresh/loadMore 用;无 total 的 feed 返回 undefined。 */
export function deserializeFeedWithTotal(
  xml: string,
  ctx: DeserializeContext,
): { items: MediaItem[]; total: number | undefined } {
  const feed = parseFeed(xml)
  const items = feed.channel.item.map((it) => {
    const kind = str(it.raw?.["tpl:kind"]) ?? ctx.kind ?? "article"
    switch (kind) {
      case "social":
        return parseSocial(it, ctx)
      case "video":
        return parseVideo(it, ctx)
      case "audio":
        return parseAudio(it, ctx)
      case "live":
        return parseLive(it, ctx)
      case "article":
      default:
        return parseArticle(it, ctx)
    }
  })
  return { items, total: totalFromRaw(feed.channel.raw) }
}

/** 从已解析 feed 的 channel.raw 读渠道真实总数;无则 undefined。 */
function totalFromRaw(raw: Record<string, unknown> | undefined): number | undefined {
  const t = raw?.["tpl:total"]
  if (t === undefined || t === null || t === "") return undefined
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

// ── shared base reconstruction ───────────────────────────────────────────────

function baseFields(it: ParsedItem, ctx: DeserializeContext) {
  const raw = it.raw ?? {}
  const author = toAuthor({
    name: str(raw["tpl:authorName"]) ?? it.author,
    avatar: str(raw["tpl:authorAvatar"]),
    handle: str(raw["tpl:authorHandle"]),
  })
  return {
    id: it.guid ?? `hash-${it.title ?? ""}`,
    subscriptionId: ctx.subscriptionId,
    title: it.title ?? "(untitled)",
    url: it.link,
    summary: str(raw["tpl:summary"]) ?? it.description,
    thumbnail: str(raw["tpl:thumbnail"]),
    author,
    publishedAt: it.pubDate ? tryEpoch(it.pubDate) : undefined,
    fetchedAt: num(raw["tpl:fetchedAt"]) ?? ctx.now,
    isUnread: boolTpl(raw["tpl:isUnread"], true),
    isStarred: boolTpl(raw["tpl:isStarred"], false),
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

function parseArticle(it: ParsedItem, ctx: DeserializeContext): MediaItem {
  const b = baseFields(it, ctx)
  const raw = it.raw ?? {}
  return {
    ...b,
    kind: "article",
    content: it.content ?? it.description,
    contentFormat: asContentFormat(raw["tpl:contentFormat"]) ?? (it.content ? "html" : undefined),
    media: parseMedia(raw),
  }
}

function parseSocial(it: ParsedItem, ctx: DeserializeContext): MediaItem {
  const b = baseFields(it, ctx)
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

function parseVideo(it: ParsedItem, ctx: DeserializeContext): MediaItem {
  const b = baseFields(it, ctx)
  const raw = it.raw ?? {}
  return {
    ...b,
    kind: "video",
    duration: num(raw["tpl:duration"]),
    stream: parseStream(raw["tpl:stream"]),
    channel:
      str(raw["tpl:channelName"]) || str(raw["tpl:channelAvatar"])
        ? { name: str(raw["tpl:channelName"]) ?? "", avatar: str(raw["tpl:channelAvatar"]) }
        : undefined,
  }
}

function parseAudio(it: ParsedItem, ctx: DeserializeContext): MediaItem {
  const b = baseFields(it, ctx)
  const raw = it.raw ?? {}
  return {
    ...b,
    kind: "audio",
    duration: num(raw["tpl:duration"]),
    artist: str(raw["tpl:artist"]),
    album: str(raw["tpl:album"]),
    stream: parseStream(raw["tpl:stream"]),
  }
}

function parseLive(it: ParsedItem, ctx: DeserializeContext): MediaItem {
  const b = baseFields(it, ctx)
  const raw = it.raw ?? {}
  const play = obj(raw["tpl:playUrls"])
  const playList = arr(play["tpl:play"])
    .map((o) => str(attr(o, "url")))
    .filter((v): v is string => !!v)
  return {
    ...b,
    kind: "live",
    platform: (str(raw["tpl:platform"]) as LivePlatformId | undefined) ?? "bilibili",
    roomId: str(raw["tpl:roomId"]) ?? "",
    liveStatus: (str(raw["tpl:liveStatus"]) as LiveStatus | undefined) ?? "unknown",
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

function parseMedia(raw: Record<string, unknown>): MediaAttachment[] | undefined {
  const nodes = arr(raw["tpl:media"])
  if (!nodes.length) return undefined
  return R.pipe(
    R.map((o: Record<string, unknown>): MediaAttachment | null => {
      const kind = str(attr(o, "kind"))
      const url = str(attr(o, "url"))
      if (!kind || !url) return null
      const att: MediaAttachment = {
        kind: kind as MediaAttachment["kind"],
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
      // strip undefined holes so deep-equal matches the source shape(pickBy 替代可变 delete)
      return R.pickBy((v: unknown) => v !== undefined, att) as MediaAttachment
    }),
    R.filter((m: MediaAttachment | null): m is MediaAttachment => m !== null),
  )(nodes)
}

function parseImages(node: unknown): SocialImage[] | undefined {
  const o = obj(node)
  const imgs = asList(o["tpl:image"])
    .map((x) => {
      // 兼容两种协议:纯文本 URL(旧) / 带 @_url @_width @_height 属性对象(新)。
      if (typeof x === "string") return { url: x }
      const o2 = typeof x === "object" ? (x as Record<string, unknown>) : {}
      const url = str(attr(o2, "url"))
      if (!url) return null
      const w = num(attr(o2, "width"))
      const h = num(attr(o2, "height"))
      const img: SocialImage = { url }
      if (w !== undefined) img.width = w
      if (h !== undefined) img.height = h
      return img
    })
    .filter((v): v is SocialImage => v !== null)
  return imgs.length ? imgs : undefined
}

function parseStream(node: unknown): MediaStream | undefined {
  const o = obj(node)
  const url = str(attr(o, "url"))
  if (!url) return undefined
  return {
    url,
    format: str(attr(o, "format")),
    headers: parseHeaders(o["tpl:streamHeaders"]),
  }
}

function parseHeaders(node: unknown): Record<string, string> | undefined {
  const o = obj(node)
  const headers = arr(o["tpl:header"])
  if (!headers.length) return undefined
  // name 非空才写入(name 为空 = 残缺节点跳过);fold 为 Record,等价原 for + out[name]=value。
  const out = R.reduce(
    (acc: Record<string, string>, h: Record<string, unknown>) => {
      const name = str(attr(h, "name"))
      const value = text(h)
      return name && value !== undefined ? { ...acc, [name]: value } : acc
    },
    {},
    headers,
  )
  return Object.keys(out).length ? out : undefined
}

// ── helpers ──────────────────────────────────────────────────────────────────

function toAuthor(fields: { name?: string; avatar?: string; handle?: string }): MediaAuthor | undefined {
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

/** `StreamingFormat` 是封闭联合;未知值退化 undefined。 */
function asStreamingFormat(v: unknown): StreamingFormat | undefined {
  const s = str(v)
  if (s === "hls" || s === "dash" || s === "progressive") return s
  return undefined
}

/** `contentFormat` 是封闭联合;未知值退化 undefined。 */
function asContentFormat(v: unknown): "html" | "markdown" | "text" | undefined {
  const s = str(v)
  if (s === "html" || s === "markdown" || s === "text") return s
  return undefined
}
