/**
 * serialize — `Item[]` → RSS 2.0 XML 字符串(标准 RSS 子集 + 最小 tpl: 扩展)。
 *
 * 输出与 RSSHub 外部实例对齐(2026-08-26):标准 RSS 2.0 + media:* 增强,
 * 任何标准阅读器可读。流/弹幕解析不塞 XML——统一下游 resolver by-url 按
 * item.link 路由解析。仅保留最小的 `tpl:` 扩展供本项目 deserialize 恢复:
 *   - `tpl:kind`(kind 判别;RSSHub 无此字段,crawler 自产必需)
 *   - `tpl:total`(翻页真实总数;标准 RSS 无)
 * 其余全部收敛到标准字段:thumbnail→media:thumbnail、media[]→enclosure+
 * media:content、author→author、summary→description。
 */
import { XMLBuilder } from "fast-xml-parser"
import type { Attachment, Item, Stream } from "./types.ts"

export interface SerializeOptions {
  channelTitle?: string
  channelLink?: string
  channelDescription?: string
  /** 渠道真实总数(翻页渠道,如 weibo cardlistInfo.total)——desktop 顶栏「已加载/总数」。 */
  total?: number
}

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  suppressEmptyNode: true,
  cdataPropName: "__cdata",
  // ⚠️ 必须 true:false 会让文本/属性里的 `&`/`<` **原样输出** → RSS 非良构 XML。
  // 实测标题含 `A & B <tag>` 时,`<tag>` 被下游解析器当标签**吞掉**(数据丢失),
  // feed URL 的 `&` 也让严格解析器拒收。fast-xml-parser 在 true 下仍**正确保留 CDATA**
  // (CDATA 内的 `&` 合法地保持原样),故「false 为保住 CDATA」的原注释是误判。
  processEntities: true,
})

export function serializeFeed(items: Item[], opts: SerializeOptions = {}): string {
  const tree: Record<string, unknown> = {
    "?xml": { "@_version": "1.0", "@_encoding": "UTF-8" },
    rss: {
      "@_version": "2.0",
      "@_xmlns:tpl": "https://tauri-playground.local/ns/tpl",
      "@_xmlns:media": "http://search.yahoo.com/mrss/",
      "@_xmlns:content": "http://purl.org/rss/1.0/modules/content/",
      channel: {
        ...(opts.channelTitle ? { title: opts.channelTitle } : {}),
        ...(opts.channelLink ? { link: opts.channelLink } : {}),
        ...(opts.channelDescription ? { description: opts.channelDescription } : {}),
        ...(opts.total !== undefined ? { "tpl:total": String(opts.total) } : {}),
        item: items.map(itemToTree),
      },
    },
  }
  return builder.build(tree)
}

// ── item → XMLBuilder object 树(标准 RSS 子集 + 最小 tpl: kind)────────────

function itemToTree(item: Item): Record<string, unknown> {
  const tree: Record<string, unknown> = {}
  tree.title = item.title
  if (item.url) tree.link = item.url
  if (item.summary) tree.description = { __cdata: item.summary }
  if ((item.kind === "article" || item.kind === "social") && item.content) {
    tree["content:encoded"] = { __cdata: item.content }
  }
  tree.guid = { "@_isPermaLink": "false", "#text": item.id }
  if (item.publishedAt !== undefined) tree.pubDate = toRfc822(item.publishedAt)

  // 标准 author(deserialize 从 author/dc:creator 读)+ 头像/句柄走 tpl:(避免边界丢,
  // 否则 MediaAuthor.avatar 恒 undefined,UI 头像退化成首字母)。
  const authorName = item.author?.name
  if (authorName) tree.author = authorName
  if (item.author?.avatar) setTpl(tree, "authorAvatar", item.author.avatar)
  if (item.author?.handle) setTpl(tree, "authorHandle", item.author.handle)

  // thumbnail → media:thumbnail。poster 兜底 thumbnail 缺失时。
  const thumb = item.thumbnail ?? item.poster
  if (thumb) tree["media:thumbnail"] = { "@_url": thumb }

  // media[] / social images → enclosure(first 可播)+ media:content(全量附件)。
  const enc = enclosure(item)
  if (enc) tree.enclosure = { "@_url": enc.url, "@_type": enc.type ?? "" }
  const mediaNodes = itemMediaNodes(item)
  if (mediaNodes.length) tree["media:content"] = mediaNodes

  // audio/video 直链 stream → enclosure(可播直链,标准语义)。
  const streamEnc = streamEnclosure(item)
  if (streamEnc && !tree.enclosure)
    tree.enclosure = { "@_url": streamEnc.url, "@_type": streamEnc.type ?? "application/octet-stream" }

  // tpl: kind(deserialize kind 判别核心)+ 各 kind 的扩展字段。
  setTpl(tree, "kind", item.kind)

  // stream 的完整形状（headers/quality/rate/dashManifest）。标准 enclosure 只能装
  // url + MIME，非 MIME 的 format 还会退化成 octet-stream；用一条 JSON 扩展保真。
  // 保留 enclosure 作为标准 RSS 兼容出口，读取侧优先 streamJson、再回退 enclosure。
  if (item.kind === "video" || item.kind === "audio") {
    const stream = (item as { stream?: Stream }).stream
    if (stream) setTpl(tree, "streamJson", JSON.stringify(stream))
  }

  // ── 公共字段(deserialize baseFields 读)──
  // ⚠️ 这些是 crawler→core 的**唯一通道**:core 用「自解析 XML 建 MediaItem」,
  // 不经 crawler 类型。此前只写 tpl:kind,导致 Live 的 liveStatus/online/platform、
  // Audio 的 artist/album、Video 的 channel 等**全在边界丢掉**(实测 174 条 live
  // 全 liveStatus="unknown"、online 恒 undefined、YouTube 直播 platform 被 URL 兜底
  // 误判为 bilibili)。凡是 crawl;channel 设了、deserialize 又读的字段,必须在此透传。
  setTplN(tree, "mimeType", item.mimeType)
  // ⚠️ fetchedAt 无标准 RSS 字段,core 却读 tpl:fetchedAt(deserialize.ts) —— 不写则
  // 恒退化成 ctx.now(丢失真实抓取时刻)。must 透传。
  setTplN(tree, "fetchedAt", (item as { fetchedAt?: number }).fetchedAt)
  setTplN(tree, "poster", item.poster)
  setTplN(tree, "width", item.width)
  setTplN(tree, "height", item.height)
  setTplN(tree, "aspectRatio", item.aspectRatio)
  setTplN(tree, "durationSec", item.durationSec)
  setTplN(tree, "bitrate", item.bitrate)
  setTplN(tree, "streamingFormat", item.streamingFormat)
  if (item.isLiveNow !== undefined) setTpl(tree, "isLiveNow", item.isLiveNow ? "1" : "0")
  setTplN(tree, "lang", item.lang)

  if (item.kind === "article") {
    // deserialize 读 tpl:contentFormat(无则按 content 有无推 html)。透传保真。
    setTplN(tree, "contentFormat", item.contentFormat)
  } else if (item.kind === "live") {
    setTpl(tree, "platform", item.platform)
    setTpl(tree, "roomId", item.roomId)
    setTpl(tree, "liveStatus", item.liveStatus)
    setTplN(tree, "online", item.online)
    if (item.isRecord !== undefined) setTpl(tree, "isRecord", item.isRecord ? "1" : "0")
    setTplN(tree, "introduction", item.introduction)
    setTplN(tree, "showTime", item.showTime)
  } else if (item.kind === "video") {
    // video 时长走 tpl:duration(与 audio 同字段名,deserialize 的 parseVideo 读它)。
    setTplN(tree, "duration", item.duration)
    setTplN(tree, "channelName", item.channel?.name)
    setTplN(tree, "channelAvatar", item.channel?.avatar)
    // 会员/付费专属(B站大会员、YouTube 频道会员):deserialize 的 parseVideo 读回。
    if (item.membersOnly !== undefined) setTpl(tree, "membersOnly", item.membersOnly ? "1" : "0")
  } else if (item.kind === "audio") {
    setTplN(tree, "duration", item.duration)
    setTplN(tree, "artist", item.artist)
    setTplN(tree, "album", item.album)
  } else if (item.kind === "social") {
    setTplN(tree, "likes", item.likes)
    setTplN(tree, "reposts", item.reposts)
    setTplN(tree, "replies", item.replies)
    if (item.isLiked !== undefined) setTpl(tree, "isLiked", item.isLiked ? "1" : "0")
    // 小红书详情页开关(匿名 GET /explore/<id> 需带 xsec_token)。
    setTplN(tree, "xsecToken", item.xsecToken)
  } else if (item.kind === "category") {
    // 目录条目的「点进去」目标：渠道 key + 完整参数（JSON）。
    setTpl(tree, "categoryChannel", item.categoryChannel)
    setTpl(tree, "categoryInfo", JSON.stringify(item.categoryInfo ?? {}))
  }

  return tree
}

/** article media[] + social images → media:content 节点(标准 RSS 媒体附件)。 */
function itemMediaNodes(item: Item): Array<Record<string, unknown>> {
  const nodes: Array<Record<string, unknown>> = []
  // article/audio/video 的 media[]
  const media = (item as { media?: Attachment[] }).media ?? []
  for (const m of media) {
    if (!m.url) continue
    const node: Record<string, unknown> = { "@_url": m.url }
    if (m.mimeType) node["@_type"] = m.mimeType
    if (m.width !== undefined) node["@_width"] = String(m.width)
    if (m.height !== undefined) node["@_height"] = String(m.height)
    if (m.durationSec !== undefined) node["@_duration"] = String(m.durationSec)
    // `@_medium` 是标准字段；`@_tpl:kind` 是精确回读依据（audio/live 无法由 medium
    // 唯一表达）。两者都写，外部阅读器忽略 tpl 即可。
    if (m.kind) {
      node["@_medium"] =
        m.kind === "image" ? "image" : m.kind === "video" ? "video" : m.kind === "audio" ? "audio" : "video"
      node["@_tpl:kind"] = m.kind
    }
    if (m.title) node["@_title"] = m.title
    if (m.poster) node["@_tpl:poster"] = m.poster
    if (m.aspectRatio !== undefined) node["@_tpl:aspectRatio"] = String(m.aspectRatio)
    if (m.bitrate !== undefined) node["@_bitrate"] = String(m.bitrate)
    if (m.streamingFormat) node["@_tpl:streamingFormat"] = m.streamingFormat
    if (m.isLiveNow !== undefined) node["@_tpl:isLiveNow"] = m.isLiveNow ? "1" : "0"
    if (m.lang) node["@_lang"] = m.lang
    nodes.push(node)
  }
  // social images → media:content(medium=image)。瀑布流图不丢(用户选标准 RSS,但图是社交核心)。
  const images =
    (item as { images?: Array<{ url: string; width?: number; height?: number; liveVideo?: string }> }).images ?? []
  for (const img of images) {
    if (!img.url) continue
    const node: Record<string, unknown> = { "@_url": img.url, "@_medium": "image" }
    if (img.width !== undefined) node["@_width"] = String(img.width)
    if (img.height !== undefined) node["@_height"] = String(img.height)
    // 实况图：静态图节点上挂视频直链（deserialize 对称读取）。漏写这边 = 实况信息静默丢。
    if (img.liveVideo) node["@_tpl:liveVideo"] = img.liveVideo
    nodes.push(node)
  }
  return nodes
}

/** 第一个可播(video/audio)附件 → 标准 enclosure(article body)。 */
function enclosure(item: Item): { url: string; type?: string } | undefined {
  const media = (item as { media?: Array<{ kind?: string; url?: string; mimeType?: string }> }).media ?? []
  for (const m of media) {
    if (m.kind === "video" || m.kind === "audio") return { url: m.url!, type: m.mimeType }
  }
  return undefined
}

/** video/audio 的 stream 直链 → 标准 enclosure(可播直链)。 */
function streamEnclosure(item: Item): { url: string; type?: string } | undefined {
  const s = (item as { stream?: Stream }).stream
  if (s?.url)
    return {
      url: s.url,
      type: s.format
        ? s.format.startsWith("audio/") || s.format.startsWith("video/")
          ? s.format
          : undefined
        : undefined,
    }
  return undefined
}

// ── helpers ──────────────────────────────────────────────────────────────────

function setTpl(tree: Record<string, unknown>, tag: string, value: string): void {
  tree[`tpl:${tag}`] = value
}

/** 仅当值非空(undefined/null/空串)时写入 tpl 字段,避免产出 `tpl:x=""` 噪声。 */
function setTplN(tree: Record<string, unknown>, tag: string, value: string | number | undefined | null): void {
  if (value === undefined || value === null || value === "") return
  tree[`tpl:${tag}`] = String(value)
}

/** epoch ms → RFC 822(RSS pubDate 格式)。 */
function toRfc822(ms: number): string {
  const d = new Date(ms)
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    `${days[d.getUTCDay()]}, ${pad(d.getUTCDate())} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} GMT`
  )
}
