/**
 * serialize — `Item[]` → RSS 2.0 XML 字符串(标准子集 + `tpl:` 扩展)。
 *
 * 用 fast-xml-parser 的 XMLBuilder 编解码(不手写字符串拼接):命名空间标签、
 * CDATA、属性、数组、空节点自闭合都由专门包处理。
 *
 * API 复刻的 channel 把上游数据归一成 `Item[]` 后,用本函数序列化成 RSS
 * XML。标准 RSS 阅读器读到标准子集(title/link/description/guid/pubDate/
 * enclosure/author),本项目自定义解析器通过 `tpl:` 读回完整模型。
 */
import { XMLBuilder } from "fast-xml-parser"
import type { Base, Item, Stream } from "./types.ts"

export interface SerializeOptions {
  channelTitle?: string
  channelLink?: string
  channelDescription?: string
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
      "@_xmlns:content": "http://purl.org/rss/1.0/modules/content/",
      channel: {
        ...(opts.channelTitle ? { title: opts.channelTitle } : {}),
        ...(opts.channelLink ? { link: opts.channelLink } : {}),
        ...(opts.channelDescription ? { description: opts.channelDescription } : {}),
        item: items.map(itemToTree),
      },
    },
  }
  return builder.build(tree)
}

// ── item → XMLBuilder object 树 ─────────────────────────────────────────────

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
  if (item.author?.name) tree.author = item.author.name

  const enc = enclosure(item)
  if (enc) tree.enclosure = { "@_url": enc.url, "@_type": enc.type ?? "" }

  // tpl: 扩展 —— 恢复完整模型。
  setTpl(tree, "sourceId", item.sourceId)
  setTpl(tree, "kind", item.kind)
  setTpl(tree, "fetchedAt", String(item.fetchedAt))
  if (item.summary !== undefined) setTpl(tree, "summary", item.summary)
  if (item.thumbnail) setTpl(tree, "thumbnail", item.thumbnail)
  if (item.author?.name) setTpl(tree, "authorName", item.author.name)
  if (item.author?.avatar) setTpl(tree, "authorAvatar", item.author.avatar)
  if (item.author?.handle) setTpl(tree, "authorHandle", item.author.handle)
  setBaseTpl(tree, item)
  setKindTpl(tree, item)

  return tree
}

function setBaseTpl(tree: Record<string, unknown>, item: Base): void {
  if (item.mimeType) setTpl(tree, "mimeType", item.mimeType)
  if (item.poster) setTpl(tree, "poster", item.poster)
  if (item.width !== undefined) setTpl(tree, "width", String(item.width))
  if (item.height !== undefined) setTpl(tree, "height", String(item.height))
  if (item.aspectRatio !== undefined) setTpl(tree, "aspectRatio", String(item.aspectRatio))
  if (item.durationSec !== undefined) setTpl(tree, "durationSec", String(item.durationSec))
  if (item.bitrate !== undefined) setTpl(tree, "bitrate", String(item.bitrate))
  if (item.streamingFormat) setTpl(tree, "streamingFormat", item.streamingFormat)
  if (item.isLiveNow !== undefined) setTpl(tree, "isLiveNow", item.isLiveNow ? "1" : "0")
  if (item.lang) setTpl(tree, "lang", item.lang)
}

function setKindTpl(tree: Record<string, unknown>, item: Item): void {
  switch (item.kind) {
    case "article": {
      if (item.contentFormat) setTpl(tree, "contentFormat", item.contentFormat)
      if (item.media?.length) {
        tree["tpl:media"] = item.media.map((m) => ({
          "@_kind": m.kind,
          "@_url": m.url,
          ...(m.title ? { "@_title": m.title } : {}),
          ...(m.mimeType ? { "@_mimeType": m.mimeType } : {}),
          ...(m.poster ? { "@_poster": m.poster } : {}),
          ...(m.width !== undefined ? { "@_width": m.width } : {}),
          ...(m.height !== undefined ? { "@_height": m.height } : {}),
          ...(m.aspectRatio !== undefined ? { "@_aspectRatio": m.aspectRatio } : {}),
          ...(m.durationSec !== undefined ? { "@_durationSec": m.durationSec } : {}),
          ...(m.bitrate !== undefined ? { "@_bitrate": m.bitrate } : {}),
          ...(m.streamingFormat ? { "@_streamingFormat": m.streamingFormat } : {}),
          ...(m.isLiveNow !== undefined ? { "@_isLiveNow": m.isLiveNow ? 1 : 0 } : {}),
          ...(m.lang ? { "@_lang": m.lang } : {}),
        }))
      }
      break
    }
    case "social": {
      if (item.images?.length) {
        // 每张图:纯 URL → 文本;带尺寸 → 属性对象(瀑布流需要宽高)。
        // 统一输出对象(URL 也转 @_url),parse 侧兼容纯文本旧数据。
        tree["tpl:images"] = {
          "tpl:image": item.images.map((img) =>
            typeof img === "string"
              ? { "@_url": img }
              : {
                  "@_url": img.url,
                  ...(img.width !== undefined ? { "@_width": String(img.width) } : {}),
                  ...(img.height !== undefined ? { "@_height": String(img.height) } : {}),
                },
          ),
        }
      }
      if (item.likes !== undefined) setTpl(tree, "likes", String(item.likes))
      if (item.reposts !== undefined) setTpl(tree, "reposts", String(item.reposts))
      if (item.replies !== undefined) setTpl(tree, "replies", String(item.replies))
      if (item.isLiked !== undefined) setTpl(tree, "isLiked", item.isLiked ? "1" : "0")
      break
    }
    case "video": {
      if (item.duration !== undefined) setTpl(tree, "duration", String(item.duration))
      if (item.stream) tree["tpl:stream"] = streamToTree(item.stream)
      if (item.channel?.name) setTpl(tree, "channelName", item.channel.name)
      if (item.channel?.avatar) setTpl(tree, "channelAvatar", item.channel.avatar)
      break
    }
    case "audio": {
      if (item.duration !== undefined) setTpl(tree, "duration", String(item.duration))
      if (item.artist) setTpl(tree, "artist", item.artist)
      if (item.album) setTpl(tree, "album", item.album)
      if (item.stream) tree["tpl:stream"] = streamToTree(item.stream)
      break
    }
    case "live": {
      setTpl(tree, "platform", item.platform)
      setTpl(tree, "roomId", item.roomId)
      setTpl(tree, "liveStatus", item.liveStatus)
      if (item.online !== undefined) setTpl(tree, "online", String(item.online))
      if (item.isRecord !== undefined) setTpl(tree, "isRecord", item.isRecord ? "1" : "0")
      if (item.introduction !== undefined) setTpl(tree, "introduction", item.introduction)
      if (item.notice !== undefined) setTpl(tree, "notice", item.notice)
      if (item.showTime !== undefined) setTpl(tree, "showTime", item.showTime)
      if (item.playUrls?.length || item.playHeaders || item.quality || item.playUrlsExpiresAt !== undefined) {
        tree["tpl:playUrls"] = livePlayToTree(item)
      }
      break
    }
  }
}

function streamToTree(s: Stream): Record<string, unknown> {
  const tree: Record<string, unknown> = { "@_url": s.url }
  if (s.format) tree["@_format"] = s.format
  if (s.headers && Object.keys(s.headers).length) {
    tree["tpl:streamHeaders"] = {
      "tpl:header": Object.entries(s.headers).map(([name, value]) => ({ "@_name": name, "#text": value })),
    }
  }
  return tree
}

function livePlayToTree(item: Extract<Item, { kind: "live" }>): Record<string, unknown> {
  const tree: Record<string, unknown> = {}
  if (item.playUrlsExpiresAt !== undefined) tree["@_expiresAt"] = item.playUrlsExpiresAt
  if (item.playUrls?.length) tree["tpl:play"] = item.playUrls.map((url) => ({ "@_url": url }))
  if (item.playHeaders && Object.keys(item.playHeaders).length) {
    tree["tpl:playHeaders"] = {
      "tpl:header": Object.entries(item.playHeaders).map(([name, value]) => ({ "@_name": name, "#text": value })),
    }
  }
  if (item.quality) tree["tpl:quality"] = item.quality
  return tree
}

/** 第一个可播(video/audio)附件 → 标准 enclosure。 */
function enclosure(item: Item): { url: string; type?: string } | undefined {
  if (item.kind !== "article") return undefined
  for (const m of item.media ?? []) {
    if (m.kind === "video" || m.kind === "audio") return { url: m.url, type: m.mimeType }
  }
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
