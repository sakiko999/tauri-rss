/**
 * YouTube 频道 InnerTube browse 解析 —— Videos tab（含频道会员标记）与 Live tab
 * （当前在播定位，`youtube:live` 的 channelId 锚点用）。
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
    membersOnly: badges.some((b: any) => b?.metadataBadgeRenderer?.style === "BADGE_STYLE_TYPE_MEMBERS_ONLY"),
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

/* ── Live tab：频道「当前在播」定位 ──────────────────────────────────────── */

/** 频道 Live tab 的 tab 选择器（NewPipe `YoutubeChannelTabExtractor` 同款）。 */
const LIVE_TAB_PARAMS = "EgdzdHJlYW1z8gYECgJ6AA%3D%3D"

export interface YoutubeChannelLive {
  /** 当前在播那场的 videoId；未开播（只有预告/回放/无直播）为 undefined。 */
  videoId?: string
  /** 在播那场的缩略图（Live tab 响应自带）。 */
  thumb?: string
  /** 频道名（browse header；取不到 undefined）。 */
  channelName?: string
}

/** 拉频道 Live tab 并定位「当前在播」的那一场（`youtube:live` 的 channelId 锚点用）。 */
export async function fetchYoutubeChannelLive(channelId: string): Promise<YoutubeChannelLive> {
  const raw = await youtubeBrowse(channelId, { params: LIVE_TAB_PARAMS })
  return parseYoutubeChannelLive(raw)
}

/**
 * Live tab 响应 → 在播场（纯函数，便于自检）。
 * Live tab 混排预告（Upcoming badge）/ 在播（LIVE badge）/ 回放（无 badge）：
 * 在播判据 = 缩略图 overlay badgeStyle 含 `_LIVE`（新版 lockup，2026-11-03 实测 NASA：
 * 在播 `THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE` + text "LIVE"，预告为 `..._DEFAULT` +
 * "Upcoming"，回放无 badge）或旧版 `videoRenderer.badges[].metadataBadgeRenderer.iconType === "LIVE"`。
 */
export function parseYoutubeChannelLive(raw: unknown): YoutubeChannelLive {
  const out: YoutubeChannelLive = { channelName: channelNameOf(raw) }
  walk(raw, (n) => {
    if (out.videoId) return
    // 新版 lockup：contentImage.thumbnailViewModel.overlays[].thumbnailBottomOverlayViewModel.badges[]
    const overlays = n?.contentImage?.thumbnailViewModel?.overlays
    if (Array.isArray(overlays)) {
      for (const o of overlays) {
        for (const b of o?.thumbnailBottomOverlayViewModel?.badges ?? []) {
          const tb = b?.thumbnailBadgeViewModel
          if (!tb) continue
          const isLive =
            String(tb?.badgeStyle ?? "").includes("_LIVE") || String(tb?.text ?? "").toUpperCase() === "LIVE"
          if (!isLive) continue
          const id = String(n?.contentId ?? "")
          if (id) {
            out.videoId = id
            out.thumb = maxThumb(n?.contentImage?.thumbnailViewModel?.image)
          }
        }
      }
    }
    // 旧版 videoRenderer：在播徽标 iconType === "LIVE"。
    const vr = n?.videoRenderer
    if (!out.videoId && vr?.videoId && Array.isArray(vr?.badges)) {
      if (vr.badges.some((b: any) => b?.metadataBadgeRenderer?.iconType === "LIVE")) {
        out.videoId = String(vr.videoId)
        out.thumb = maxThumb(vr?.thumbnail)
      }
    }
  })
  return out
}

/** browse header → 频道名（新版 pageHeaderViewModel / 旧版 c4TabbedHeaderRenderer）。 */
function channelNameOf(raw: unknown): string | undefined {
  const h = (raw as { header?: Record<string, any> })?.header
  const name =
    h?.pageHeaderRenderer?.content?.pageHeaderViewModel?.title?.dynamicTextViewModel?.text?.content ??
    h?.c4TabbedHeaderRenderer?.title?.simpleText ??
    h?.c4TabbedHeaderRenderer?.title
  return typeof name === "string" && name ? name : undefined
}
