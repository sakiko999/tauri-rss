/**
 * XML/RSS parser — RSS 2.0 + Atom normalization.
 *
 * Ported from `rss-reader/packages/app/lib/rss-parser.ts`, normalized to feed
 * `fast-xml-parser`'s real output shape (attributes live under `@_` keys when
 * `ignoreAttributes: false, attributeNamePrefix: "@_"`). The original had a
 * latent bug: its Atom branch read `.link.href` / `.author.name`, but with the
 * configured prefix those are `link["@_href"]` / `author["@_name"]`. Fixed here.
 *
 * Only the parsing + normalization belongs here; mapping to `MediaItem` lives
 * in `rss-to-items.ts`.
 */
import { XMLParser } from "fast-xml-parser"

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
})

/** Normalized feed shape (RSS 2.0 terminology) for both RSS and Atom inputs. */
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
  /**
   * Raw parsed node, kept for media extraction (enclosure / media:content /
   * itunes / Atom link rel=enclosure). See `source/rss/media.ts`.
   */
  raw?: Record<string, unknown>
}

function ensureArray<T>(val: T | T[] | undefined): T[] {
  if (val === undefined || val === null) return []
  return Array.isArray(val) ? val : [val]
}

/** Coerce a `link` value — may be a plain string or an object with `@_href`. */
function asLink(val: unknown): string {
  if (typeof val === "string") return val
  if (val !== null && typeof val === "object") {
    const href = (val as Record<string, unknown>)["@_href"]
    if (typeof href === "string") return href
  }
  return ""
}

/** Coerce an `author` value — RSS plain string, Atom {@_name} attr, or Atom {name} child. */
function asAuthor(val: unknown): string {
  if (typeof val === "string") return val
  if (val !== null && typeof val === "object") {
    const o = val as Record<string, unknown>
    // Atom <author><name>..</name></author> → { name: "..." }
    // Atom <author @_name="..."/>           → { "@_name": "..." }
    const name = o["name"] ?? o["@_name"]
    if (typeof name === "string") return name
  }
  return ""
}

/**
 * Parse an RSS 2.0 or Atom XML string into a normalized `ParsedFeed`.
 * RSS 2.0 (`<rss><channel>`) passes through with items arrayed; Atom
 * (`<feed><entry>`) is normalized into the same shape.
 */
export function parseFeed(xml: string): ParsedFeed {
  const raw = parser.parse(xml) as Record<string, unknown>
  const root = (raw.rss ?? raw.feed ?? raw) as Record<string, unknown>

  // RSS 2.0: <rss><channel>...<item>...</item></channel></rss>
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

  // Atom: <feed><title>...<entry>...</entry></feed> — normalize to ParsedFeed
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
  // fast-xml-parser represents a typed/CDATA element as an object, e.g. Atom
  // `<title type="html"><![CDATA[...]]></title>` → { "#text": "...", "@_type": "html" }.
  // Pull the text out so typed Atom fields (title/content/summary) aren't lost.
  if (typeof val === "object") {
    const o = val as Record<string, unknown>
    const text = o["#text"]
    if (typeof text === "string") return text
    if (text !== undefined) return asString(text)
  }
  return undefined
}
