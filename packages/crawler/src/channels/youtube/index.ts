/**
 * youtube channel —— YouTube 频道(官方 RSS),产 Video Item。
 *
 * 官方 feed `youtube.com/feeds/videos.xml?channel_id=` 已带 media:group
 * (thumbnail + description)和 yt:videoId。本 channel 解析它,规范化
 * videoId → watch URL,产 Video Item。
 */
import type { Item, Stream, Video } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { RssChannel, RssSource, SourceInfo, VideoPlayable } from "../../index.ts"
import { apiFetch } from "../factory.ts"
import { httpText, now } from "../../host.ts"
import { parseFeed, type ParsedItem } from "@tauri-playground/xml"
import { resolveYoutubeStreams } from "./client.ts"
export { YoutubeLiveChannel } from "./live.ts"

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

/**
 * 懒解析可播流。真实直链走 InnerTube player API(见 client.ts):
 * ANDROID_VR client(主力,2026-08 起免 poToken)——视频渐进式 mp4(音视频合一)、
 * 直播自带 hlsManifestUrl;失败 fallback WEB / 直播 iOS。
 * ⚠️ 直链失败直接抛错——不兜底 `format:"web"`(watch URL 不可播,会让 player
 * 误报「成功 N 条流」实则黑屏,日志误导)。解析失败由 player resolveFailed 处理。
 */
async function resolveYoutubePlay(itemId: string): Promise<Stream[]> {
  const videoId = itemId.replace(/^https?:\/\/www\.youtube\.com\/watch\?v=/, "")
  return resolveYoutubeStreams(videoId)
}

export class YoutubeChannel implements RssChannel {
  readonly key: string
  readonly name: string
  readonly kind = "video" as const
  // videoId 可选:订阅单视频/直播(如常驻直播间);channelId 订阅整个频道(RSS)。
  readonly sourceInfoTpl = [
    { key: "videoId", label: "视频/直播 ID(可选)", required: false },
    { key: "channelId", label: "频道 ID(可选,与 videoId 二选一)", required: false },
  ]
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

  // 视频源:implements VideoPlayable,resolvePlay 是模块纯函数。
  getSource(info: SourceInfo): RssSource & VideoPlayable {
    return {
      fetch: apiFetch(() => this.fetchItems(info), () => this.channelOptions(info)),
      resolvePlay: resolveYoutubePlay,
    }
  }

  private async fetchItems(info: SourceInfo): Promise<Item[]> {
    const t = now()
    // 单视频/直播订阅(videoId 优先):产单个 Item,resolvePlay 直接播该 videoId。
    const videoId = info.videoId ?? ""
    if (videoId) {
      return [videoItem(videoId, t)]
    }
    const channelId = info.channelId ?? this.defaultChannelId ?? ""
    if (!channelId) throw new Error("youtube: 需要 channelId 或 videoId")
    const xml = await httpText(
      `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`,
      { "user-agent": UA },
    )
    const feed = parseFeed(xml)
    return feed.channel.item.map((entry) => entryToVideo(entry, t))
  }
  private channelOptions(info: SourceInfo): SerializeOptions {
    if (info.videoId) {
      return { channelTitle: `YouTube ${info.videoId}`, channelLink: `https://www.youtube.com/watch?v=${info.videoId}` }
    }
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

/** 单视频/直播订阅的 Item(无 RSS 元数据,标题用 videoId 占位,播放时 resolvePlay 拿直链)。 */
function videoItem(videoId: string, t: number): Video {
  return {
    id: videoId,
    sourceId: "youtube",
    kind: "video",
    title: `YouTube ${videoId}`,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    // 稳定缩略图约定:i.ytimg.com/vi/<videoId>/hqdefault.jpg —— 零请求,对视频/直播
    // 都有效(未开播也有占位封面)。hqdefault=480×360,足够列表缩略图用。
    thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    poster: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    fetchedAt: t,
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
