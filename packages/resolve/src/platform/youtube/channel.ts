/**
 * YouTube 频道 Videos tab —— InnerTube browse 解析（含频道会员标记）。
 *
 * 为什么不用官方 RSS：`feeds/videos.xml` 只有 title/link/published/media:group，
 * **没有会员（Members only）标记**，也没有观看数。InnerTube 的频道 Videos tab 才带
 * `metadataRows[].badges[].badgeViewModel.badgeText = "Members only"`。
 *
 * 两种响应布局都要兼容：
 *   - 新版 `lockupViewModel`（2026-10 实测）：contentId/title/metadataRows；
 *   - 旧版 `videoRenderer`：`badges[].metadataBadgeRenderer.style ===
 *     "BADGE_STYLE_TYPE_MEMBERS_ONLY"`（NewPipe PR #1280 同款判据）。
 *
 * ⚠️ 相对时间只能拿到 "9 days ago"：不从它反推绝对时间（每次刷新都会漂），
 * `publishedText` 原样带回，列表排序/时间兜底交给 core 的 fetchedAt。
 * ⚠️ 频道页约 1MB；不做缓存 —— 每个频道订阅一轮只拉一次。
 */
import { youtubeBrowse } from "./client.ts"

/** 频道 Videos tab 的 tab 选择器（InnerTube browse params）。 */
const VIDEOS_TAB_PARAMS = "EgZ2aWRlb3PyBgQKAjoA"

export interface YoutubeChannelVideo {
  videoId: string
  title: string
  thumb?: string
  /** "2.5M views" 原始文本（不解析成数字：缩写/本地化误差大）。 */
  viewsText?: string
  /** "9 days ago" 相对时间。 */
  publishedText?: string
  /** 频道会员专属：列表可见，播放要求加入频道会员。 */
  membersOnly: boolean
}

export interface YoutubeChannelVideosPage {
  videos: YoutubeChannelVideo[]
  /** 下一页令牌（无 = 没有更多）。 */
  continuation?: string
}

/** 拉频道 Videos tab（或下一页）。 */
export async function fetchYoutubeChannelVideos(
  channelId: string,
  opts: { continuation?: string } = {},
): Promise<YoutubeChannelVideosPage> {
  const raw = await youtubeBrowse(
    channelId,
    opts.continuation ? { continuation: opts.continuation } : { params: VIDEOS_TAB_PARAMS },
  )
  return parseYoutubeChannelVideos(raw)
}

/** InnerTube 响应 → 视频列表 + 下一页令牌（纯函数，便于自检）。 */
export function parseYoutubeChannelVideos(raw: unknown): YoutubeChannelVideosPage {
  const videos: YoutubeChannelVideo[] = []
  const seen = new Set<string>()
  const push = (v: YoutubeChannelVideo | null): void => {
    if (!v || seen.has(v.videoId)) return
    seen.add(v.videoId)
    videos.push(v)
  }
  walk(raw, (n) => {
    if (n.videoRenderer) push(fromVideoRenderer(n.videoRenderer))
    else if (n.lockupViewModel) push(fromLockup(n.lockupViewModel))
  })
  const continuation = continuationOf(raw)
  return continuation ? { videos, continuation } : { videos }
}

function walk(node: unknown, visit: (n: Record<string, any>) => void): void {
  if (!node || typeof node !== "object") return
  visit(node as Record<string, any>)
  for (const v of Object.values(node)) walk(v, visit)
}

/** InnerTube 文本节点：simpleText / runs 拼接 / 新版 `content`。 */
function textOf(node: unknown): string | undefined {
  const n = node as { simpleText?: unknown; content?: unknown; runs?: Array<{ text?: unknown }> } | undefined
  if (typeof n?.simpleText === "string") return n.simpleText
  if (typeof n?.content === "string") return n.content
  if (Array.isArray(n?.runs)) {
    const joined = n.runs.map((r) => String(r?.text ?? "")).join("")
    return joined || undefined
  }
  return undefined
}

/** 缩略图：`sources[]` / `thumbnails[]` 里取 width 最大的一张。 */
function maxThumb(node: unknown): string | undefined {
  const holder = node as { sources?: unknown; thumbnails?: unknown } | undefined
  const list = Array.isArray(holder?.sources)
    ? holder.sources
    : Array.isArray(holder?.thumbnails)
      ? holder.thumbnails
      : undefined
  if (!list?.length) return undefined
  let best = list[0] as { url?: unknown; width?: unknown }
  for (const s of list as Array<{ url?: unknown; width?: unknown }>) {
    if (Number(s?.width ?? 0) > Number(best?.width ?? 0)) best = s
  }
  return typeof best?.url === "string" ? best.url : undefined
}

function fromLockup(lk: Record<string, any>): YoutubeChannelVideo | null {
  const videoId = String(lk?.contentId ?? "")
  // 频道页同一批里还有 playlist / channel lockup，只收视频。
  if (!videoId || !/VIDEO/.test(String(lk?.contentType ?? ""))) return null
  const md = lk?.metadata?.lockupMetadataViewModel
  const rows = md?.metadata?.contentMetadataViewModel?.metadataRows
  let viewsText: string | undefined
  let publishedText: string | undefined
  let membersOnly = false
  for (const row of Array.isArray(rows) ? rows : []) {
    for (const part of row?.metadataParts ?? []) {
      const t = textOf(part?.text)
      if (!t) continue
      if (/\bviews?\b/i.test(t)) viewsText ??= t
      else if (/\bago\b/i.test(t)) publishedText ??= t
    }
    for (const b of row?.badges ?? []) {
      const badgeText = b?.badgeViewModel?.badgeText
      if (typeof badgeText === "string" && /members?\s*only/i.test(badgeText)) membersOnly = true
    }
  }
  return {
    videoId,
    title: textOf(md?.title) ?? videoId,
    thumb: maxThumb(lk?.contentImage?.thumbnailViewModel?.image),
    viewsText,
    publishedText,
    membersOnly,
  }
}

function fromVideoRenderer(vr: Record<string, any>): YoutubeChannelVideo | null {
  const videoId = String(vr?.videoId ?? "")
  if (!videoId) return null
  const badges = Array.isArray(vr?.badges) ? vr.badges : []
  return {
    videoId,
    title: textOf(vr?.title) ?? videoId,
    thumb: maxThumb(vr?.thumbnail),
    viewsText: textOf(vr?.viewCountText),
    publishedText: textOf(vr?.publishedTimeText),
    membersOnly: badges.some(
      (b: any) => b?.metadataBadgeRenderer?.style === "BADGE_STYLE_TYPE_MEMBERS_ONLY",
    ),
  }
}

function continuationOf(root: unknown): string | undefined {
  let token: string | undefined
  walk(root, (n) => {
    const t = n?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token
    if (typeof t === "string" && !token) token = t
  })
  return token
}
