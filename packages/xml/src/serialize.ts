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
import type { Item, Stream } from "./types.ts"

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
  processEntities: false,
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

  // 标准 author(deserialize 从 author/dc:creator 读)。
  const authorName = item.author?.name
  if (authorName) tree.author = authorName

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
  if (streamEnc && !tree.enclosure) tree.enclosure = { "@_url": streamEnc.url, "@_type": streamEnc.type ?? "application/octet-stream" }

  // 最小 tpl: kind(deserialize kind 判别核心)。
  setTpl(tree, "kind", item.kind)

  return tree
}

/** article media[] + social images → media:content 节点(标准 RSS 媒体附件)。 */
function itemMediaNodes(item: Item): Array<Record<string, unknown>> {
  const nodes: Array<Record<string, unknown>> = []
  // article/audio/video 的 media[]
  const media = (item as { media?: Array<{ kind?: string; url?: string; mimeType?: string; title?: string; width?: number; height?: number; durationSec?: number }> }).media ?? []
  for (const m of media) {
    if (!m.url) continue
    const node: Record<string, unknown> = { "@_url": m.url }
    if (m.mimeType) node["@_type"] = m.mimeType
    if (m.width !== undefined) node["@_width"] = String(m.width)
    if (m.height !== undefined) node["@_height"] = String(m.height)
    if (m.durationSec !== undefined) node["@_duration"] = String(m.durationSec)
    if (m.kind) {
      node["@_medium"] = m.kind === "image" ? "image" : m.kind === "video" ? "video" : m.kind === "audio" ? "audio" : "video"
    }
    if (m.title) node["@_title"] = m.title
    nodes.push(node)
  }
  // social images → media:content(medium=image)。瀑布流图不丢(用户选标准 RSS,但图是社交核心)。
  const images = (item as { images?: Array<{ url: string; width?: number; height?: number }> }).images ?? []
  for (const img of images) {
    if (!img.url) continue
    const node: Record<string, unknown> = { "@_url": img.url, "@_medium": "image" }
    if (img.width !== undefined) node["@_width"] = String(img.width)
    if (img.height !== undefined) node["@_height"] = String(img.height)
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
  if (s?.url) return { url: s.url, type: s.format ? (s.format.startsWith("audio/") || s.format.startsWith("video/") ? s.format : undefined) : undefined }
  return undefined
}

// ── helpers ──────────────────────────────────────────────────────────────────

function setTpl(tree: Record<string, unknown>, tag: string, value: string): void {
  tree[`tpl:${tag}`] = value
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
