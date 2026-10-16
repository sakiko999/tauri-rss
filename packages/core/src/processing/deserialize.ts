/**
 * deserializeFeed — RSS 2.0 XML → MediaItem[]。
 *
 * 消费 **标准 RSS 2.0 + media: 增强**(与 RSSHub 外部实例、crawler serialize 对齐):
 *   - title/link/description/guid/pubDate/author
 *   - enclosure / media:content(附件与可播流)
 *   - media:thumbnail(缩略图)
 *   - 最小 `tpl:` 扩展(crawler 自产):`tpl:kind`(kind 判别)、`tpl:total`(翻页总数)
 *
 * kind 判别:`tpl:kind` > ctx.kind(channel 声明) > enclosure(mime 推断 audio) > article。
 * live 的 platform/roomId 从 item.url 推导(复刻 resolver 路由语义,不依赖 crawler)。
 * app 层语义由 core 注入:subscriptionId 来自 ctx,isUnread 默认 true、isStarred 默认 false。
 */
import type { MediaAttachment, MediaAuthor, MediaItem, MediaKind, MediaStream, SocialImage, StreamingFormat } from "../types/media-item.ts"
import type { LivePlatformId, LiveStatus } from "../types/live.ts"
import { parseFeed, type ParsedItem } from "@amoeba/xml"

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

/** 反序列化 + 渠道真实总数(一次 parseFeed 双产出)。 */
export function deserializeFeedWithTotal(
  xml: string,
  ctx: DeserializeContext,
): { items: MediaItem[]; total: number | undefined } {
  const feed = parseFeed(xml)
  const items = feed.channel.item.map((it) => {
    const kind = resolveKind(it.raw ?? {}, ctx.kind)
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

/** kind 解析:最小 tpl:kind > enclosure/audio(mime)> ctx.kind > article。 */
function resolveKind(raw: Record<string, unknown>, ctxKind: MediaKind | undefined): MediaKind {
  const tpl = str(raw["tpl:kind"])
  if (tpl && (tpl === "article" || tpl === "video" || tpl === "audio" || tpl === "live" || tpl === "social")) {
    return tpl
  }
  // enclosure 派生:audio 确定性跨 kind(视频不跨——video 直链也可能 enclosure)。
  const audioFromEnclosure = (() => {
    const enc = enclosureVal(raw["enclosure"])
    if (!enc) return undefined
    const t = typeOfEnclosure(enc)
    return inferKindFromMime(t)
  })()
  if (audioFromEnclosure) return audioFromEnclosure
  return ctxKind ?? "article"
}

/** 从已解析 feed 的 channel.raw 读渠道真实总数;无则 undefined。 */
function totalFromRaw(raw: Record<string, unknown> | undefined): number | undefined {
  const t = raw?.["tpl:total"]
  if (t === undefined || t === null || t === "") return undefined
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

// ── shared base reconstruction ───────────────────────────────────────────────

/**
 * 摘要去 HTML。
 *
 * ⚠️ RSS 的 `description` 通常是**整段 HTML**(很多源直接塞 `<p>Article URL: <a href=…>`),
 * 而 `summary` 的用途是列表/卡片的**一行纯文本摘要**。不剥的话列表里会直接显示
 * `<p>Article URL: <a href="https://…` 这种原始标签(实测 Hacker News / BBC / GitHub
 * 三个源的每一行都是这样)。正文走 `content`(保留 HTML,渲染前 DOMPurify),不受影响。
 */
function stripHtml(input: string | undefined): string | undefined {
  if (!input) return input
  // 没有标签就直接返回(省一次 replace,也避免把 `a < b` 这种纯文本误伤)。
  if (!/<[a-z!/]/i.test(input)) return decodeEntities(input)
  const noScripts = input
    // 先整体丢弃 script/style(其内容不是文本,留着会变成乱码摘要)。
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    // 块级标签换成空格,避免 `</p><p>` 把两段粘成一个词。
    .replace(/<\/?(p|div|br|li|tr|h[1-6]|blockquote)\b[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, "")
  return decodeEntities(noScripts).replace(/\s+/g, " ").trim()
}

/** 常见实体解码(不引依赖:超出这几类的留给前端原样显示,不做半吊子解析)。 */
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…")
    .replace(/&amp;/g, "&")
}

function baseFields(it: ParsedItem, ctx: DeserializeContext) {
  const raw = it.raw ?? {}
  const author = toAuthor({
    name: it.author?.trim() || str(raw["dc:creator"]) || undefined,
    // 头像/句柄走 tpl:(标准 RSS 无的位置)——serialize 已透传,不读则边界丢掉。
    avatar: str(raw["tpl:authorAvatar"]),
    handle: str(raw["tpl:authorHandle"]),
  })
  return {
    // ⚠️ guid 缺失兜底用 **link**(唯一,一篇文章一个 URL),不用 title —— 同标题条目
    // (系列文/转载/纯 RSS)会撞 id:store.patch 遍历改**所有**同 id 条目、reading map 按 id
    // 回填 → 标一条已读两条一起变、星标/续播互相覆盖。title 只作 link 也缺时的末位兜底。
    id: it.guid ?? it.link ?? `hash-${it.title ?? ""}`,
    subscriptionId: ctx.subscriptionId,
    title: it.title ?? "(untitled)",
    url: it.link,
    summary: stripHtml(it.description),
    thumbnail: rsshubThumbnail(raw),
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
    media: rsshubArticleMedia(raw),
  }
}

function parseSocial(it: ParsedItem, ctx: DeserializeContext): MediaItem {
  const b = baseFields(it, ctx)
  const raw = it.raw ?? {}
  return {
    ...b,
    kind: "social",
    content: it.content ?? it.description ?? "",
    images: parseImagesFromMedia(raw),
    likes: num(raw["tpl:likes"]),
    reposts: num(raw["tpl:reposts"]),
    replies: num(raw["tpl:replies"]),
    isLiked: boolTpl(raw["tpl:isLiked"], undefined),
    // 小红书详情页开关(匿名 GET /explore/<id> 需带列表项 xsec_token)。
    xsecToken: str(raw["tpl:xsecToken"]),
  }
}

function parseVideo(it: ParsedItem, ctx: DeserializeContext): MediaItem {
  const b = baseFields(it, ctx)
  const raw = it.raw ?? {}
  return {
    ...b,
    kind: "video",
    duration: num(raw["tpl:duration"]),
    // 直链(stream)从标准 enclosure 读;无则 undefined(resolver by-url 重解析)。
    stream: parseStreamFromEnclosure(raw),
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
    // audio 的 enclosure 即可播直链。
    stream: parseStreamFromEnclosure(raw),
  }
}

/** live:platform/roomId 从 item.url 推导,不依赖 resolver。 */
function parseLive(it: ParsedItem, ctx: DeserializeContext): MediaItem {
  const b = baseFields(it, ctx)
  const raw = it.raw ?? {}
  const { platform, roomId } = liveFromUrl(it.link)
  return {
    ...b,
    kind: "live",
    platform: (str(raw["tpl:platform"]) as LivePlatformId | undefined) ?? platform,
    roomId: str(raw["tpl:roomId"]) ?? roomId,
    liveStatus: (str(raw["tpl:liveStatus"]) as LiveStatus | undefined) ?? "unknown",
    online: num(raw["tpl:online"]),
    isRecord: boolTpl(raw["tpl:isRecord"], undefined),
    introduction: str(raw["tpl:introduction"]),
    notice: str(raw["tpl:notice"]),
    showTime: str(raw["tpl:showTime"]),
    // 播放流/弹幕由 resolver by-url 解析,XML 不再带 playUrls。
  }
}

// ── nested parsers(标准字段优先 + 最小 tpl 兜底)───────────────────────────

/** audio/video enclosure → MediaStream(直链)。 */
function parseStreamFromEnclosure(raw: Record<string, unknown>): MediaStream | undefined {
  const enc = enclosureVal(raw["enclosure"])
  if (!enc) return undefined
  const url = str(attr(obj(enc as Record<string, unknown>), "url"))
  if (!url) return undefined
  return { url, format: typeOfEnclosure(enc) }
}

/** media:content[medium=image] → SocialImage[](crawler serialize 与 RSSHub 输出兼容)。 */
function parseImagesFromMedia(raw: Record<string, unknown>): SocialImage[] | undefined {
  const mc = raw["media:content"]
  if (!mc) return undefined
  const imgs: SocialImage[] = []
  for (const m of asList(mc)) {
    const o = obj(m as Record<string, unknown>)
    const medium = String(attr(o, "medium") ?? "")
    const type = String(attr(o, "type") ?? "")
    if (medium !== "image" && !type.startsWith("image/")) continue
    const url = str(attr(o, "url"))
    if (!url) continue
    const w = num(attr(o, "width"))
    const h = num(attr(o, "height"))
    const img: SocialImage = { url }
    if (w !== undefined) img.width = w
    if (h !== undefined) img.height = h
    imgs.push(img)
  }
  return imgs.length ? imgs : undefined
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

function asList(v: unknown): unknown[] {
  if (v === undefined || v === null) return []
  return Array.isArray(v) ? v : [v]
}

/**
 * RFC 822 pubDate → epoch ms。
 *
 * ⚠️ **上限守卫是必须的,不是多余的防御**:上游给错单位(如把毫秒当秒再 ×1000)会产出
 * 公元 5 万年级别的时间戳,`new Date` 照收不误。那种值在「按发布时间倒序」里**永久钉在
 * 最前**,还会污染 `fmtAgo`(显示成「22 万年以前」这种)与 `isToday`(今日口径)。
 * 实测踩过:`xhs` 的 `time` 从秒改成毫秒后被打到 1791961240000000,「全部」页前 12 条
 * 全是 social。宁可判为 undefined(沉底)也不要放一个错的极端值进来。
 * 上限取「现在 + 1 天」,容忍时区/时钟偏差,但拦得住任何量级错误。
 */
function tryEpoch(s: string): number | undefined {
  const ms = new Date(s).getTime()
  if (Number.isNaN(ms)) return undefined
  if (ms > Date.now() + 86_400_000) return undefined
  return ms
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

// ── RSSHub 标准 RSS 增强 helpers ─────────────────────────────────────────────

function enclosureVal(v: unknown): unknown {
  if (v === undefined || v === null) return undefined
  return Array.isArray(v) ? v.find((e) => e != null) ?? v[0] : v
}

function typeOfEnclosure(enc: unknown): string | undefined {
  const o = obj(enc as unknown as Record<string, unknown>)
  return str(attr(o, "type"))
}

function inferKindFromMime(mime: string | undefined): MediaKind | undefined {
  if (!mime) return undefined
  if (mime.startsWith("audio/")) return "audio"
  return undefined
}

/** RSSHub thumbnail:media:thumbnail@url / media:content[medium=image]@url / itunes:image@href。 */
function rsshubThumbnail(raw: Record<string, unknown>): string | undefined {
  const t = raw["media:thumbnail"]
  if (t) {
    const u = str(attr(obj(t as Record<string, unknown>), "url"))
    if (u) return u
  }
  const mc = raw["media:content"]
  if (mc) {
    for (const m of asList(mc)) {
      const o = obj(m as Record<string, unknown>)
      const u = str(attr(o, "url"))
      if (u && (String(attr(o, "medium") ?? "") === "image" || String(attr(o, "type") ?? "").startsWith("image/"))) return u
    }
  }
  const ii = raw["itunes:image"]
  if (ii) {
    const u = str(attr(obj(ii as Record<string, unknown>), "href"))
    if (u) return u
  }
  return undefined
}

/** RSSHub article 附件:enclosure(非 audio)+ media:content 的非 image 媒体 → Article media[]。 */
function rsshubArticleMedia(raw: Record<string, unknown>): MediaAttachment[] | undefined {
  const out: MediaAttachment[] = []
  // ⚠️ 同一媒体常在 enclosure 与 media:content 各出现一次(同 URL)→ 不去重会出现
  // 两份相同附件。按 URL 去重。
  const seen = new Set<string>()
  const push = (m: MediaAttachment) => {
    if (seen.has(m.url)) return
    seen.add(m.url)
    out.push(m)
  }
  const enc = enclosureVal(raw["enclosure"])
  if (enc) {
    const o = obj(enc as Record<string, unknown>)
    const url = str(attr(o, "url"))
    const type = str(attr(o, "type"))
    if (url && type && !type.startsWith("audio/")) {
      push({
        kind: type.startsWith("video/") ? "video" : type.startsWith("image/") ? "image" : "video",
        url,
        mimeType: type,
      })
    }
  }
  const mc = raw["media:content"]
  if (mc) {
    for (const m of asList(mc)) {
      const o = obj(m as Record<string, unknown>)
      const url = str(attr(o, "url"))
      const medium = String(attr(o, "medium") ?? "")
      const type = String(attr(o, "type") ?? "")
      if (!url) continue
      if (medium === "video" || type.startsWith("video/")) {
        push({ kind: "video", url, mimeType: type || undefined })
      }
    }
  }
  return out.length ? out : undefined
}

/** 从 live item.url 推导 platform/roomId(复刻 resolver 路由语义,不依赖 crawler)。 */
function liveFromUrl(url: string | undefined): { platform: LivePlatformId; roomId: string } {
  const u = url ?? ""
  const platform: LivePlatformId =
    /live\.bilibili\.com/.test(u) ? "bilibili"
    : /(?:^|\.)douyu\.com/.test(u) ? "douyu"
    : /(?:^|\.)huya\.com/.test(u) ? "huya"
    : /live\.douyin\.com/.test(u) ? "douyin"
    : "bilibili"
  const rid =
    platform === "bilibili" ? u.match(/live\.bilibili\.com\/(\d+)/)?.[1] ?? ""
    : platform === "douyu" ? u.match(/douyu\.com\/(\d+)/)?.[1] ?? ""
    : platform === "huya" ? u.match(/huya\.com\/(\d+)/)?.[1] ?? ""
    : u.match(/live\.douyin\.com\/(\S+)/)?.[1] ?? ""
  return { platform, roomId: rid }
}