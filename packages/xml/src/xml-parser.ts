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
  // ⚠️ 关闭文本自动转数值:否则「数字形字符串」在边界被转成 number ——
  // `roomId:"007"`→7、`guid:"0123"`→123(丢前导零 + 丢类型),`"1e3"`→1000。
  // RSS 文本一律按字符串读,数值字段由 core 的 num()/Number() 显式转换(全部走它),
  // 故关闭后读端无需改动。属性(`@_x`)本就不受此选项影响,恒为字符串。
  parseTagValue: false,
})

export interface ParsedFeed {
  channel: {
    title?: string
    link?: string
    description?: string
    item: ParsedItem[]
    /** 原始 channel 节点(core 读 tpl:total 等 channel 级扩展)。 */
    raw?: Record<string, unknown>
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
  const pick = (v: unknown): string => {
    if (typeof v === "string") return v
    if (v !== null && typeof v === "object") {
      const o = v as Record<string, unknown>
      if (typeof o["@_href"] === "string") return o["@_href"] as string
      if (typeof o["#text"] === "string") return o["#text"] as string
    }
    return ""
  }
  // ⚠️ Atom 允许一条 entry 多个 <link>(rel="alternate"/"self"/"enclosure"…),此时
  // e.link 是**数组**。原实现把数组当对象取 @_href → 永远得到空串(Atom 条目丢链接)。
  // 取 rel="alternate"(条目网页地址)优先,其次无 rel 的,最后才将就第一个有 href 的。
  if (Array.isArray(val)) {
    const objs = val.filter((v): v is Record<string, unknown> => !!v && typeof v === "object")
    const alt = objs.find((o) => o["@_rel"] === "alternate") ?? objs.find((o) => o["@_rel"] === undefined)
    return (alt ? pick(alt) : "") || val.map(pick).find((s) => s) || ""
  }
  return pick(val)
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
        // 保留原始 channel 节点(core 读 tpl:total 等 channel 级扩展)。
        raw: channel,
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
