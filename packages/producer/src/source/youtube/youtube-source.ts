/**
 * YoutubeSource — YouTube channel feed via the official RSS.
 *
 * YouTube exposes native RSS per channel:
 *   `https://www.youtube.com/feeds/videos.xml?channel_id=<id>`
 * No API key, no puppeteer — the feed already carries Atom `<entry>` with
 * `media:group` (thumbnail + description) and `yt:videoId`.
 *
 * Why a dedicated kind instead of plain `rss`? The official feed is an Atom
 * feed whose canonical video link (`yt:videoId` → `https://www.youtube.com/
 * watch?v=…`) and shorts-detection (`media:content` duration) are YouTube-
 * specific. This adapter normalizes those and maps each entry to a `FeedVideo`
 * (not the generic ArticleItem the RSS path produces), and it demonstrates the
 * plugin seam: `registerSource(new YoutubeSource())` is all it takes.
 *
 * Sources:
 *   - tmp/RSSHub/lib/routes/youtube/channel.ts (confirms official RSS route)
 *   - youtube.com/feeds/videos.xml (live shape, verified 2026-08)
 */
import type { FeedItem, FeedVideo } from "../../types/feed-item.ts"
import type { ProducerHost } from "../../types/producer-host.ts"
import type { YoutubeSubscription } from "../../types/subscription.ts"
import { BaseSource } from "../base-source.ts"
import { parseFeed, type ParsedItem } from "../../parse/xml-parser.ts"

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

const FEED_URL = (channelId: string) =>
  `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`

export class YoutubeSource extends BaseSource<YoutubeSubscription> {
  readonly sourceId = "youtube" as const
  readonly builtinSubscriptions = [
    { id: "yt-3b1b", title: "3Blue1Brown (YouTube)", tag: "API · 频道", config: { channelId: "UCYO_jab_esuFRV4b17AJtAw" } },
    { id: "yt-lex", title: "Lex Fridman (YouTube)", tag: "API · 频道", config: { channelId: "UCSHZKyawb77ixDdsGog4iWA" } },
    { id: "yt-kenjee", title: "Ken Jee (YouTube)", tag: "API · 频道", config: { channelId: "UCiT9RITQ9PW6BhXK0y2jaeg" } },
  ] as const
  readonly meta = {
    name: "YouTube 频道",
    description: "官方 RSS,零登录",
    configSchema: [
      { key: "channelId", label: "频道 ID", type: "text" as const, required: true },
    ],
  }

  async fetch(subscription: YoutubeSubscription, host: ProducerHost): Promise<FeedItem[]> {
    const channelId = String(subscription.config.channelId ?? "")
    if (!channelId) throw new Error("youtube: channelId is required")
    const res = await host.http.request({
      url: FEED_URL(channelId),
      method: "GET",
      responseType: "text",
      headers: { "user-agent": UA },
    })
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`YouTube feed HTTP ${res.status}: ${FEED_URL(channelId)}`)
    }
    const xml = typeof res.body === "string" ? res.body : new TextDecoder().decode(res.body)
    const feed = parseFeed(xml)
    return feed.channel.item.map((entry) => this.entryToVideo(entry, host.now()))
  }

  /** Build a subscription from form values (plugin seam: config → Subscription). */
  createSubscription(
    base: { id: string; sourceId: string; title: string; enabled: boolean; createdAt: number; updatedAt: number },
    config: Record<string, unknown>,
  ): YoutubeSubscription {
    return {
      ...base,
      sourceId: "youtube",
      config: { channelId: String(config.channelId ?? "") },
    }
  }

  private entryToVideo(entry: ParsedItem, now: number): FeedVideo {
    const raw = entry.raw ?? {}
    const videoId = asString(raw["yt:videoId"]) ?? videoIdFromLink(entry.link)
    const watchUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : entry.link
    const mediaGroup = asObj(raw["media:group"])
    const content = asObj(mediaGroup["media:content"])
    const thumbnail = mediaThumb(mediaGroup) ?? entry.description
    const isShorts = Boolean(asString(content["@_duration"]) && Number(asString(content["@_duration"])) < 60)

    return {
      id: videoId ?? entry.guid ?? entry.link ?? "",
      sourceId: "youtube",
      kind: "video",
      title: entry.title ?? "(untitled)",
      url: watchUrl,
      summary: mediaDesc(mediaGroup),
      thumbnail,
      poster: thumbnail,
      author: entry.author ? { name: entry.author } : undefined,
      publishedAt: entry.pubDate ? new Date(entry.pubDate).getTime() : undefined,
      fetchedAt: now,
      isLiveNow: isShorts ? undefined : false,
      lang: "en",
      duration: asString(content["@_duration"]) ? Number(asString(content["@_duration"])) : undefined,
    }
  }
}

function videoIdFromLink(link?: string): string | undefined {
  if (!link) return undefined
  const m = link.match(/[?&]v=([\w-]{6,})/)
  return m?.[1]
}

function mediaThumb(group: Record<string, unknown>): string | undefined {
  const t = asObj(group["media:thumbnail"])
  return asString(t["@_url"])
}

function mediaDesc(group: Record<string, unknown>): string | undefined {
  // `media:description` is a plain text node → string; with CDATA → { #text }.
  return asString(group["media:description"])
}

function asObj(v: unknown): Record<string, unknown> {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>
  return {}
}

function asString(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v === "string") return v
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  const o = v as Record<string, unknown>
  const t = o["#text"]
  if (t !== undefined) return asString(t)
  return undefined
}
