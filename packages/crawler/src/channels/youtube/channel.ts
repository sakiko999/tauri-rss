/**
 * youtube channel —— YouTube 频道(官方 RSS),产 Video Item。
 *
 * 官方 feed `youtube.com/feeds/videos.xml?channel_id=` 已带 media:group
 * (thumbnail + description)和 yt:videoId。本 channel 解析它,规范化
 * videoId → watch URL,产 Video Item。
 */

import {
  DESKTOP_CHROME_UA,
  fetchYoutubeChannelVideos,
  getYoutubeLiveMeta,
  httpText,
  now,
  type YoutubeChannelVideo,
} from "@amoeba/resolve"
import type { Item, Video } from "@amoeba/xml"
import { type ParsedItem, parseFeed, serializeFeed, type SerializeOptions } from "@amoeba/xml"

import type { Pageable, RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetchItems } from "../factory.ts"

const UA = DESKTOP_CHROME_UA

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

  // 仅输出 Video item(与 rsshub 一致);流/弹幕走 crawler/resolver(按 item.url→watch?v=)。
  getSource(info: SourceInfo): RssSource & Partial<Pageable> {
    return {
      fetch: apiFetchItems(
        () => this.fetchItems(info),
        () => this.channelOptions(info),
      ),
      // InnerTube continuation 翻页(cursor = 上游 token,数值 apiFetchMore 不适用)。
      fetchMore: async (cursor?: string) => {
        const opts = this.channelOptions(info)
        const channelId = info.channelId ?? this.defaultChannelId ?? ""
        // 单视频/直播订阅(videoId)无翻页语义;不认识的信息源也直接到底。
        if (info.videoId || !channelId) return { xml: serializeFeed([], opts) }
        // 首翻无 cursor:先拉一次首页拿 token(条目丢弃,twitch streams 两步法同款;
        // 不能闭包缓存首页 token —— refresh 会换掉首页)。失败要 throw,别返回空页。
        let token = cursor
        if (token === undefined) {
          const first = await fetchYoutubeChannelVideos(channelId)
          token = first.continuation
          if (!token) return { xml: serializeFeed([], opts) } // 一页到底
        }
        const page = await fetchYoutubeChannelVideos(channelId, { continuation: token })
        const items = page.videos.map((v) => channelVideoToItem(v, now()))
        return {
          xml: serializeFeed(items, opts),
          ...(page.continuation ? { cursor: page.continuation, hasMore: true } : {}),
        }
      },
    }
  }

  private async fetchItems(info: SourceInfo): Promise<Item[]> {
    const t = now()
    // 单视频/直播订阅(videoId 优先):产单个 Item,resolvePlay 直接播该 videoId。
    const videoId = info.videoId ?? ""
    if (videoId) {
      // 取真实标题/频道名(此前硬编码占位 "YouTube <id>");失败回退占位,不阻塞。
      const meta = await getYoutubeLiveMeta(videoId).catch(() => null)
      return [videoItem(videoId, t, meta)]
    }
    const channelId = info.channelId ?? this.defaultChannelId ?? ""
    if (!channelId) throw new Error("youtube: 需要 channelId 或 videoId")
    // 主路径：InnerTube 频道 Videos tab —— 官方 RSS 没有会员（Members only）标记。
    // 失败（风控 / 页面结构变化）回退官方 RSS：条目仍出，但 membersOnly 缺失、
    // 精确发布时间可用（InnerTube 只给 "9 days ago" 这类相对文本）。
    try {
      const page = await fetchYoutubeChannelVideos(channelId)
      if (page.videos.length) return page.videos.map((v) => channelVideoToItem(v, t))
    } catch {
      /* 回退 RSS */
    }
    const xml = await httpText(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`, {
      "user-agent": UA,
    })
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

/** YouTube Atom feed 条目 → Video(`youtube` 频道与 `youtube:playlist` 共用)。 */
export function entryToVideo(entry: ParsedItem, t: number, sourceId = "youtube"): Video {
  const raw = entry.raw ?? {}
  const videoId = asString(raw["yt:videoId"]) ?? videoIdFromLink(entry.link)
  const watchUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : entry.link
  const mediaGroup = asObj(raw["media:group"])
  const content = asObj(mediaGroup["media:content"])
  const thumbnail = mediaThumb(mediaGroup)
  const duration = asString(content["@_duration"]) ? Number(asString(content["@_duration"])) : undefined
  return {
    id: videoId ?? entry.guid ?? entry.link ?? "",
    sourceId,
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

/**
 * InnerTube 频道条目 → Video。
 * 不设 publishedAt：InnerTube 只给相对时间，反推绝对时间会在每次刷新时漂移，
 * 交给 core 用 fetchedAt 兜底（与 bili:precious 的人工榜单同策略）。
 */
function channelVideoToItem(v: YoutubeChannelVideo, t: number): Video {
  const thumb = v.thumb ?? `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`
  const meta = [v.viewsText, v.publishedText].filter(Boolean).join(" · ")
  return {
    id: v.videoId,
    sourceId: "youtube",
    kind: "video",
    title: v.title,
    url: `https://www.youtube.com/watch?v=${v.videoId}`,
    summary: meta || undefined,
    thumbnail: thumb,
    poster: thumb,
    fetchedAt: t,
    // undefined = 不写 tpl:membersOnly（serialize 只在有值时写）。
    membersOnly: v.membersOnly || undefined,
  }
}

/** 单视频/直播订阅的 Item(RSS 无元数据 → 一次 player API 取真实标题/频道;失败用 videoId 占位)。 */
function videoItem(videoId: string, t: number, meta: { title: string; author: string } | null): Video {
  return {
    id: videoId,
    sourceId: "youtube",
    kind: "video",
    title: meta?.title || `YouTube ${videoId}`,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    // 稳定缩略图约定:i.ytimg.com/vi/<videoId>/hqdefault.jpg —— 零请求,对视频/直播
    // 都有效(未开播也有占位封面)。hqdefault=480×360,足够列表缩略图用。
    thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    poster: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    author: meta?.author ? { name: meta.author } : undefined,
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
