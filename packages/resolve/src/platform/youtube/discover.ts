/**
 * YouTube 直播页(Live tab)匿名解析 —— 直播热门 / 栏目分区 / 栏目目录。
 *
 * 端点 `POST youtubei/v1/browse` + `browseId=UC4R8DWoMoI7CAwX8_LjQHig`。响应不是平铺
 * 列表,而是若干栏目:
 *
 *   contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content
 *     .richGridRenderer.contents[]                 ← 实测布局(2026-10-20)
 *       richSectionRenderer.content.richShelfRenderer
 *         title   = "Live Now" / "Live Now - Gaming" / "Recent Live Streams" …
 *         contents[].richItemRenderer.content.videoRenderer
 *
 * 实测各栏目:`Live Now` 12 条、`Recent Live Streams` 12、`Upcoming Live Streams` 11、
 * `Live Now - News/Gaming/Sports` 各 12。**没有 continuation**,一页到底。
 *
 * ⚠️ `Recent` / `Upcoming` 也在同一页里:只保留带 LIVE badge 的条目
 * (`thumbnailOverlays[].thumbnailOverlayTimeStatusRenderer.text === "LIVE"`),所以这两个
 * 栏目会解析成空数组 —— 调用方按栏目名/条数自行取舍。
 * ⚠️ 栏目名随 `hl`/地区变化,client 固定 `hl:"en"`、`gl:"US"`;本模块按栏目名归一成
 * slug 匹配(`Live Now` → `hot`,`Live Now - Gaming` → `gaming`)。
 * ⚠️ 整页约 800KB,热门与栏目两个 channel 可能在同一轮刷新里各拉一次 → 结果做
 * 5 分钟内存缓存(含并发去重:缓存的是 Promise)。不落库、不写内容缓存。
 */
import type { YoutubeLiveHit } from "./client.ts"
import { youtubeBrowse } from "./client.ts"
import { now } from "../../host.ts"

/** 直播页 browseId(YouTube 官方的 Live tab 频道)。 */
const LIVE_PAGE_BROWSE_ID = "UC4R8DWoMoI7CAwX8_LjQHig"
const CACHE_TTL_MS = 5 * 60_000

/** 直播页的一个栏目。 */
export interface YoutubeLiveShelf {
  /** 原始栏目名(如 "Live Now - Gaming")。 */
  title: string
  /** 归一 slug("hot" / "gaming" / "sports" / 其它栏目名小写连字符)。 */
  slug: string
  /** 该栏目里带 LIVE badge 的条目;Recent/Upcoming 恒为空。 */
  hits: YoutubeLiveHit[]
}

/** InnerTube 文本节点:simpleText 优先,runs 拼接兜底。 */
function textOf(node: unknown): string | undefined {
  const n = node as { simpleText?: unknown; runs?: Array<{ text?: unknown }> }
  if (typeof n?.simpleText === "string") return n.simpleText
  if (Array.isArray(n?.runs)) {
    const joined = n.runs.map((r) => String(r?.text ?? "")).join("")
    return joined || undefined
  }
  return undefined
}

/** 缩略图节点:取 width 最大的那张。 */
function thumbOf(node: unknown): string | undefined {
  const list = (node as { thumbnails?: Array<{ url?: unknown; width?: unknown }> })?.thumbnails
  if (!Array.isArray(list) || !list.length) return undefined
  let best = list[0]!
  for (const t of list) if (Number(t.width ?? 0) > Number(best.width ?? 0)) best = t
  return typeof best.url === "string" ? best.url : undefined
}

/**
 * 观看数:只认 "1,234 watching"。同一页里还有 "25,198,023 views"(回放)与
 * "5 waiting"(预告),后者不是并发观众,不能取数字。
 */
function viewersOf(text: string | undefined): number | undefined {
  if (!text || !/watching/i.test(text)) return undefined
  // ⚠️ 大数字是**缩写**("1.2K watching")—— 直接剥非数字会得到 "12"(少 100 倍),
  // 既显示错人数,又让 byViewers() 把最热的排到最后。
  const m = /([\d.,]+)\s*([KMB])?/i.exec(text)
  if (!m) return undefined
  const base = Number(m[1]!.replace(/,/g, ""))
  if (!Number.isFinite(base) || base <= 0) return undefined
  const unit = m[2]?.toUpperCase()
  const mul = unit === "K" ? 1e3 : unit === "M" ? 1e6 : unit === "B" ? 1e9 : 1
  return Math.round(base * mul)
}

/** 是否在播:thumbnailOverlays 里有一项的时间状态文本为 LIVE。 */
function isLiveBadge(overlays: unknown): boolean {
  if (!Array.isArray(overlays)) return false
  return overlays.some((o) => {
    const text = textOf((o as { thumbnailOverlayTimeStatusRenderer?: { text?: unknown } })?.thumbnailOverlayTimeStatusRenderer?.text)
    return text?.toUpperCase() === "LIVE"
  })
}

/** 栏目名 → slug:`Live Now` → `hot`,`Live Now - Gaming` → `gaming`。 */
export function youtubeShelfSlug(title: string): string {
  const t = title.trim()
  if (!/^live now/i.test(t)) return slugify(t)
  const rest = t.replace(/^live now/i, "").replace(/^[\s-]+/, "").trim()
  return rest ? slugify(rest) : "hot"
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/**
 * 用户输入的栏目 → slug。接受裸 slug(`gaming`)、栏目名(`Gaming`)与完整栏目名
 * (`Live Now - Gaming`)。非法返回 null(调用方负责抛清晰错误)。
 */
export function normalizeYoutubeLiveCategory(input: string | null | undefined): string | null {
  const raw = String(input ?? "").trim()
  if (!raw) return null
  const slug = /^live now/i.test(raw) ? youtubeShelfSlug(raw) : slugify(raw)
  return /^[a-z0-9-]{2,32}$/.test(slug) ? slug : null
}

function videoRendererToHit(vr: Record<string, any>): YoutubeLiveHit | null {
  const videoId = String(vr?.videoId ?? "")
  if (!videoId) return null
  return {
    videoId,
    title: textOf(vr?.title) ?? videoId,
    channelTitle: textOf(vr?.ownerText) ?? textOf(vr?.longBylineText),
    thumb: thumbOf(vr?.thumbnail),
    viewers: viewersOf(textOf(vr?.viewCountText)),
  }
}

/**
 * 直播页原始 JSON → 栏目数组(纯函数,便于自检)。兼容两种布局:
 * 实测的 `richSectionRenderer.content.richShelfRenderer` 与旧版直接
 * `sectionListRenderer.contents[].richShelfRenderer`。没有标题的区块(顶部轮播)跳过。
 */
export function parseYoutubeLiveShelves(raw: unknown): YoutubeLiveShelf[] {
  const root = raw as any
  const tabContent = root?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content
  const sections: unknown[] =
    tabContent?.richGridRenderer?.contents ?? tabContent?.sectionListRenderer?.contents ?? []
  const out: YoutubeLiveShelf[] = []
  for (const section of sections) {
    const s = section as any
    const shelf = s?.richSectionRenderer?.content?.richShelfRenderer ?? s?.richShelfRenderer
    if (!shelf) continue
    const title = textOf(shelf.title)
    if (!title) continue
    const hits: YoutubeLiveHit[] = []
    for (const item of Array.isArray(shelf.contents) ? shelf.contents : []) {
      const vr = item?.richItemRenderer?.content?.videoRenderer
      if (!vr || !isLiveBadge(vr.thumbnailOverlays)) continue
      const hit = videoRendererToHit(vr)
      if (hit) hits.push(hit)
    }
    out.push({ title, slug: youtubeShelfSlug(title), hits })
  }
  return out
}

/** 5 分钟缓存(缓存 Promise:并发调用只发一次请求)。 */
let cache: { at: number; promise: Promise<YoutubeLiveShelf[]> } | null = null

/**
 * 拉取直播页并解析成栏目。5 分钟内复用同一份结果;失败不缓存(下次重试)。
 * 解析不出任何栏目视为页面结构变化,抛清晰错误(不能静默返回空列表 ——
 * core 会把它当成「没有更多」)。
 */
export function fetchYoutubeLiveShelves(): Promise<YoutubeLiveShelf[]> {
  if (cache && now() - cache.at < CACHE_TTL_MS) return cache.promise
  const promise = youtubeBrowse(LIVE_PAGE_BROWSE_ID)
    .then(parseYoutubeLiveShelves)
    .then((shelves) => {
      if (!shelves.length) throw new Error("YouTube 直播页没有可用栏目（页面结构可能已变）")
      return shelves
    })
  cache = { at: now(), promise }
  promise.catch(() => {
    if (cache?.promise === promise) cache = null
  })
  return promise
}
