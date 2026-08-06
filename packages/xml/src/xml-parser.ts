/**
 * XML/RSS parser — RSS 2.0 + Atom normalization(复刻 producer 版)。
 *
 * 用 fast-xml-parser,attributes 在 `@_` 键下。仅解析 + 归一,映射成 Item
 * 留给各 channel(如 youtube)。
 */
import { XMLParser } from "fast-xml-parser"

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
})

export interface ParsedFeed {
  channel: {
    title?: string
    link?: string
    description?: string
    item: ParsedItem[]
  }
}

export interface ParsedItem {
  title?: string
  link?: string
  description?: string
  content?: string
  pubDate?: string
  author?: string
  guid?: string
  /** 原始解析节点,channel 可从中抠自定义字段(yt:videoId / media:group)。 */
  raw?: Record<string, unknown>
}

function ensureArray<T>(val: T | T[] | undefined): T[] {
  if (val === undefined || val === null) return []
  return Array.isArray(val) ? val : [val]
}

function asLink(val: unknown): string {
  if (typeof val === "string") return val
  if (val !== null && typeof val === "object") {
    const href = (val as Record<string, unknown>)["@_href"]
    if (typeof href === "string") return href
  }
  return ""
}

function asAuthor(val: unknown): string {
  if (typeof val === "string") return val
  if (val !== null && typeof val === "object") {
    const o = val as Record<string, unknown>
    const name = o["name"] ?? o["@_name"]
    if (typeof name === "string") return name
  }
  return ""
}

export function parseFeed(xml: string): ParsedFeed {
  const raw = parser.parse(xml) as Record<string, unknown>
  const root = (raw.rss ?? raw.feed ?? raw) as Record<string, unknown>

  const channel = root.channel as Record<string, unknown> | undefined
  if (channel) {
    return {
      channel: {
        title: asString(channel.title),
        link: asString(channel.link),
        description: asString(channel.description),
        item: ensureArray(channel.item as ParsedItem | ParsedItem[] | undefined).map(normalizeItem),
      },
    }
  }

  const entries = ensureArray(root.entry as Record<string, unknown> | Record<string, unknown>[] | undefined)
  return {
    channel: {
      title: asString(root.title),
      link: asLink(root.link),
      description: asString(root.subtitle),
      item: entries.map((e) => normalizeAtomEntry(e as Record<string, unknown>)),
    },
  }
}

function normalizeItem(item: ParsedItem): ParsedItem {
  return {
    title: asString(item.title),
    link: asLink(item.link),
    description: asString(item.description),
    content: asString(item["content:encoded" as keyof ParsedItem] ?? item.content),
    pubDate: asString(item.pubDate),
    author: asAuthor(item.author),
    guid: asString(item.guid),
    raw: item as Record<string, unknown>,
  }
}

function normalizeAtomEntry(e: Record<string, unknown>): ParsedItem {
  return {
    title: asString(e.title),
    link: asLink(e.link),
    description: asString(e.summary ?? e.content),
    content: asString(e.content ?? e.summary),
    pubDate: asString(e.published ?? e.updated),
    author: asAuthor(e.author),
    guid: asString(e.id),
    raw: e,
  }
}

function asString(val: unknown): string | undefined {
  if (val === undefined || val === null) return undefined
  if (typeof val === "string") return val
  if (typeof val === "number" || typeof val === "boolean") return String(val)
  if (typeof val === "object") {
    const o = val as Record<string, unknown>
    const text = o["#text"]
    if (typeof text === "string") return text
    if (text !== undefined) return asString(text)
  }
  return undefined
}
