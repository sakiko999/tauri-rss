/**
 * youtube channel —— YouTube 频道(官方 RSS),产 Video Item。
 *
 * 官方 feed `youtube.com/feeds/videos.xml?channel_id=` 已带 media:group
 * (thumbnail + description)和 yt:videoId。本 channel 解析它,规范化
 * videoId → watch URL,产 Video Item。
 */
import type { Item, Stream, Video } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { RssChannel, SourceInfo } from "../../index.ts"
import { createApiSource } from "../factory.ts"
import { httpText, now } from "../../host.ts"
import { parseFeed, type ParsedItem } from "@tauri-playground/xml"

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

/**
 * 懒解析可播流。YouTube 官方 RSS 无直链,返回 `format: "web"` 的页面流
 * (watch URL),UI 收到非 hls/flv/mp4 的 format 时打开页面播放。
 */
function resolveYoutubePlay(itemId: string): Promise<Stream[]> {
  const videoId = itemId.replace(/^https?:\/\/www\.youtube\.com\/watch\?v=/, "")
  return Promise.resolve([{ url: `https://www.youtube.com/watch?v=${videoId}`, format: "web", headers: { "user-agent": UA } }])
}

export class YoutubeChannel implements RssChannel {
  readonly key: string
  readonly name: string
  readonly kind = "video" as const
  readonly sourceInfoTpl = [{ key: "channelId", label: "频道 ID", required: true }]
  /** 内置频道 ID(可选):存在 = 无需输入 channelId 即可订阅一个默认频道。 */
  readonly defaultChannelId?: string

  constructor(options: { key?: string; name?: string; defaultChannelId?: string } = {}) {
    this.key = options.key ?? "youtube"
    this.name = options.name ?? "YouTube 频道"
    this.defaultChannelId = options.defaultChannelId
  }

  get defaultInfo(): SourceInfo | undefined {
    return this.defaultChannelId ? { channelId: this.defaultChannelId } : undefined
  }

  // 懒解析能力作为 factory capabilities 装配进 source:resolvePlay(itemId)。
  getSource = createApiSource((info) => this.fetchItems(info), (info) => this.channelOptions(info), { resolvePlay: resolveYoutubePlay })

  private async fetchItems(info: SourceInfo): Promise<Item[]> {
    const channelId = info.channelId ?? this.defaultChannelId ?? ""
    if (!channelId) throw new Error("youtube: 需要 channelId")
    const xml = await httpText(
      `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`,
      { "user-agent": UA },
    )
    const feed = parseFeed(xml)
    const t = now()
    return feed.channel.item.map((entry) => entryToVideo(entry, t))
  }
  private channelOptions(info: SourceInfo): SerializeOptions {
    const channelId = info.channelId ?? this.defaultChannelId ?? ""
    return { channelTitle: `YouTube ${channelId}`, channelLink: `https://www.youtube.com/channel/${channelId}` }
  }
}

function entryToVideo(entry: ParsedItem, t: number): Video {
  const raw = entry.raw ?? {}
  const videoId = asString(raw["yt:videoId"]) ?? videoIdFromLink(entry.link)
  const watchUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : entry.link
  const mediaGroup = asObj(raw["media:group"])
  const content = asObj(mediaGroup["media:content"])
  const thumbnail = mediaThumb(mediaGroup)
  const duration = asString(content["@_duration"]) ? Number(asString(content["@_duration"])) : undefined
  return {
    id: videoId ?? entry.guid ?? entry.link ?? "",
    sourceId: "youtube",
    kind: "video",
    title: entry.title ?? "(untitled)",
    url: watchUrl,
    summary: asString(mediaGroup["media:description"]),
    thumbnail,
    poster: thumbnail,
    author: entry.author ? { name: entry.author } : undefined,
    publishedAt: entry.pubDate ? new Date(entry.pubDate).getTime() : undefined,
    fetchedAt: t,
    duration,
  }
}

function videoIdFromLink(link?: string): string | undefined {
  const m = link?.match(/[?&]v=([\w-]{6,})/)
  return m?.[1]
}
function mediaThumb(group: Record<string, unknown>): string | undefined {
  return asString(asObj(group["media:thumbnail"])["@_url"])
}
function asObj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}
function asString(v: unknown): string | undefined {
  if (typeof v === "string") return v
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  const t = asObj(v)["#text"]
  return typeof t === "string" ? t : undefined
}
