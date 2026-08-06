/**
 * RssPodcastChannel — 播客 RSS,产 AudioItem(kind=audio)。
 *
 * 与 RawRssChannel(透传上游 XML)不同,本 channel 解析标准播客 RSS 的
 * enclosure + itunes 元数据,归一成 Audio Item 再 serializeFeed(带 tpl: 扩展),
 * 让 core 能按 tpl:kind=audio 正确解析。
 */
import type { Audio, Item } from "@tauri-playground/xml"
import { BaseChannel } from "../base.ts"
import type { SourceInfo } from "../../index.ts"
import { httpText, now } from "../../host.ts"
import { parseFeed, type ParsedItem } from "@tauri-playground/xml"

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

export class RssPodcastChannel extends BaseChannel {
  readonly key = "rss:podcast"
  readonly name = "播客 RSS"
  readonly kind = "audio" as const
  readonly sourceInfoTpl = [{ key: "url", label: "Feed URL", required: true }]

  protected async fetchItems(info: SourceInfo): Promise<Item[]> {
    const url = info.url ?? ""
    if (!url) throw new Error("rss:podcast 需要 url")
    const xml = await httpText(url, { "user-agent": UA })
    const feed = parseFeed(xml)
    const t = now()
    return feed.channel.item
      .map((it) => itemToAudio(it, t))
      .filter((a): a is Audio => a !== undefined)
  }
}

/** 标准播客 item → Audio。无 audio enclosure 的 item 跳过。 */
function itemToAudio(it: ParsedItem, t: number): Audio | undefined {
  const raw = it.raw ?? {}
  const enclosure = firstByType(raw["enclosure"], /audio\//)
  if (!enclosure) return undefined
  const url = attrStr(enclosure, "url")
  if (!url) return undefined

  const itunesDuration = textStr(raw["itunes:duration"])
  const duration = itunesDuration ? parseDuration(itunesDuration) : undefined

  return {
    id: it.guid ?? `hash-${it.title ?? ""}`,
    sourceId: "rss:podcast",
    kind: "audio",
    title: it.title ?? "(untitled)",
    url: it.link ?? url,
    summary: it.description,
    thumbnail: itunesImage(raw) ?? textStr(raw["itunes:image"]),
    author: it.author ? { name: it.author } : undefined,
    publishedAt: it.pubDate ? new Date(it.pubDate).getTime() : undefined,
    fetchedAt: t,
    artist: textStr(raw["itunes:author"]) || it.author,
    duration,
    stream: { url, format: enclosureMime(enclosure) },
  }
}

/** 取第一个 type 匹配正则的子节点。 */
function firstByType(node: unknown, re: RegExp): Record<string, unknown> | undefined {
  const list = Array.isArray(node) ? node : node !== undefined ? [node] : []
  for (const n of list) {
    if (n && typeof n === "object") {
      const o = n as Record<string, unknown>
      const type = attrStr(o, "type")
      if (type && re.test(type)) return o
    }
  }
  return undefined
}

/** 从 itunes:image 节点取 @href(或它unes:image 文本)。 */
function itunesImage(raw: Record<string, unknown>): string | undefined {
  const img = raw["itunes:image"]
  if (img && typeof img === "object") {
    const href = attrStr(img as Record<string, unknown>, "href")
    if (href) return href
  }
  return undefined
}

/** "mm:ss" / "h:mm:ss" / 纯秒 → 秒数。 */
function parseDuration(s: string): number | undefined {
  const parts = s.split(":").map((p) => Number(p))
  if (parts.some((n) => Number.isNaN(n))) return undefined
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!
  if (parts.length === 1) return parts[0]
  return undefined
}

/** 节点文本(@_ 前缀属性键 / #text / 字符串)。 */
function textStr(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v === "string") return v
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  if (typeof v === "object") {
    const o = v as Record<string, unknown>
    const t = o["#text"]
    if (t !== undefined) return textStr(t)
  }
  return undefined
}

/** 取 @_attr 属性。 */
function attrStr(o: Record<string, unknown>, name: string): string | undefined {
  const v = o[`@_${name}`]
  return textStr(v)
}

/** enclosure type(MIME)作 stream format 标签。 */
function enclosureMime(o: Record<string, unknown>): string | undefined {
  return attrStr(o, "type")
}
