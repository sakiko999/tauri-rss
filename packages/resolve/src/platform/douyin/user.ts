/**
 * 抖音用户作品（主页「作品」tab）→ Social 条目。
 *
 * 数据来自**页面自己**发的 `aweme/v1/web/aweme/post/` 响应（crawler 侧用
 * `capturePage` 被动捕获，见 `channels/douyin/user.ts`）。这里只做纯映射，不发请求。
 *
 * ⚠️ 为什么不做「页面内 fetch」/自签直连（2026-10-30 实测）：
 *   - 页面自己的该请求 `200 application/json`；
 *   - 但**原样重放同一条 URL**（页面上下文 fetch、同一份 cookie）返回的是 835KB
 *     的 HTML 骨架；补 `uifid` 头、用页面 `localStorage.xmst` 的 msToken、再用本仓
 *     ABOGUS_JS 现算 `a_bogus`，全部仍是 HTML。
 *   → 该接口认「由页面自己的 JS 发出」这一事实（`a_bogus` 与 HttpOnly 的 msToken
 *     cookie 绑定、疑似一次性），所以只能被动捕获，不能像微博那样页面内 fetch。
 *
 * 字段依据：RSSHub 的 douyin user 路由（拦页面 XHR 后读 `aweme_list`）与
 * MediaCrawler 的 `/aweme/post/` 解析；`video.bit_rate[]` 里已经是 CDN 直链，
 * 按 bit_rate 降序取最高档（产流侧的「最高清晰度排最前」契约）。
 */

import type { Social, SocialImage } from "@amoeba/xml"

import { toHttps } from "../../utils/url.ts"

export const DOUYIN_WEB = "https://www.douyin.com"

/** 用户主页 URL（被动采集的导航目标）。 */
export function douyinUserUrl(secUid: string): string {
  return `${DOUYIN_WEB}/user/${secUid}`
}

/** 作品详情页 URL（`item.url`；播放/打开原文都走它）。 */
function awemeUrl(awemeId: string): string {
  return `${DOUYIN_WEB}/video/${awemeId}`
}

/** url_list[0] 统一改成 https（源站给的是 http，WebView 里会被混合内容拦）。 */
function firstUrl(list: unknown): string | undefined {
  const arr = Array.isArray(list) ? list : []
  const first = arr.find((v) => typeof v === "string" && v.trim())
  return typeof first === "string" ? toHttps(first.trim()) : undefined
}

/** 头像/封面这类 `{ url_list }` 包装。 */
function urlOf(wrapped: any): string | undefined {
  return firstUrl(wrapped?.url_list)
}

/**
 * 视频直链：`video.bit_rate[]` 按 `bit_rate` 降序取第一个可用 play_addr，
 * 缺失时回退 `video.play_addr`（老结构/图文）。
 */
export function pickAwemePlayUrl(video: any): string | undefined {
  const rates = Array.isArray(video?.bit_rate) ? [...video.bit_rate] : []
  rates.sort((a: any, b: any) => Number(b?.bit_rate ?? 0) - Number(a?.bit_rate ?? 0))
  for (const r of rates) {
    const u = urlOf(r?.play_addr)
    if (u) return u
  }
  return urlOf(video?.play_addr) ?? urlOf(video?.play_addr_h264) ?? urlOf(video?.download_addr)
}

/** 时间线文本可能带换行/话题，标题只取首行；全空时给个中性标题。 */
function awemeTitle(desc: unknown): string {
  const text = String(desc ?? "").replace(/\r/g, "")
  const line = text
    .split("\n")
    .map((s) => s.trim())
    .find(Boolean)
  return (line ?? "").slice(0, 120) || "抖音作品"
}

/** 图文作品的图片集（`images[].url_list`，带宽高时保留，供瀑布流比例）。 */
function awemeImages(raw: any): SocialImage[] {
  const list = Array.isArray(raw?.images) ? raw.images : []
  const out: SocialImage[] = []
  for (const img of list) {
    const url = urlOf(img)
    if (!url) continue
    const width = Number(img?.width) || undefined
    const height = Number(img?.height) || undefined
    out.push({ url, ...(width && height ? { width, height } : {}) })
  }
  return out
}

/**
 * 一条 `aweme` → `Social`。没有 id 的条目直接丢弃（无法去重/无法打开）。
 *
 * `hasVideo` 与 `video` 同时给：列表数据里直链就有（不像 xhs 要等详情），所以能播的
 * 直接带 `video`；`hasVideo` 只是给卡片角标一个稳定信号。
 *
 * ⚠️ **图文 vs 视频**（2026-10-30 实测）：`aweme_type === 68`/有 `images[]` 的是图文，
 * 它的 `video.play_addr` 其实是**背景音乐**（`ies-music` 域、`duration` 为 0、
 * `bit_rate` 为空）。照搬「有 play_addr 就当视频」会让图文作品播放 BGM，判据必须是
 * 「有 images → 图文」「duration > 0 且 bit_rate 非空 → 视频」。
 */
export function awemeToSocial(raw: any, sourceKey: string, fetchedAt: number): Social | null {
  const awemeId = String(raw?.aweme_id ?? "").trim()
  if (!awemeId) return null

  const video = raw?.video
  const images = awemeImages(raw)
  const durationMs = Number(video?.duration ?? 0)
  const bitRates = Array.isArray(video?.bit_rate) ? video.bit_rate.length : 0
  // 图文作品(images 非空)的 play_addr 是 BGM,不是视频流：一律不给 video。
  const play = !images.length && durationMs > 0 && bitRates > 0 ? pickAwemePlayUrl(video) : undefined
  // 视频帖没有图集时用视频封面充当展示图（详情弹窗的 poster 也靠它）。
  if (!images.length) {
    const cover = urlOf(video?.cover) ?? urlOf(video?.origin_cover) ?? urlOf(video?.dynamic_cover)
    if (cover) images.push({ url: cover })
  }

  const author = raw?.author
  const nickname = String(author?.nickname ?? "").trim()
  const avatar = urlOf(author?.avatar_thumb) ?? urlOf(author?.avatar_medium) ?? urlOf(author?.avatar_larger)
  const stats = raw?.statistics
  const desc = String(raw?.desc ?? "")

  const item: Social = {
    id: `dy-${awemeId}`,
    sourceId: sourceKey,
    kind: "social",
    title: awemeTitle(desc),
    url: awemeUrl(awemeId),
    fetchedAt,
    content: desc,
    // 抖音作者信息是条目级的（同一订阅也可能转发别人的作品），不要写成订阅级。
    ...(nickname ? { author: { name: nickname, ...(avatar ? { avatar } : {}) } } : {}),
    ...(Number(raw?.create_time) > 0 ? { publishedAt: Number(raw.create_time) * 1000 } : {}),
    ...(images.length ? { images } : {}),
    ...(play ? { video: play, hasVideo: true } : {}),
    ...(durationMs > 0 ? { durationSec: Math.round(durationMs / 1000) } : {}),
    ...(Number(stats?.digg_count) >= 0 ? { likes: Number(stats.digg_count) } : {}),
    ...(Number(stats?.comment_count) >= 0 ? { replies: Number(stats.comment_count) } : {}),
    ...(Number(stats?.share_count) >= 0 ? { reposts: Number(stats.share_count) } : {}),
  }
  return item
}

/**
 * `aweme_list` → `Social[]`（按 aweme_id 去重）。
 *
 * ⚠️ 去重是必需的：滚动翻页时同一批可能被页面重复追加（xhs user 的置顶组同源案底），
 * 而订阅内 id 唯一是 core 的硬契约。
 */
export function awemeListToSocial(list: unknown, sourceKey: string, fetchedAt: number): Social[] {
  const arr = Array.isArray(list) ? list : []
  const seen = new Set<string>()
  const out: Social[] = []
  for (const raw of arr) {
    const item = awemeToSocial(raw, sourceKey, fetchedAt)
    if (!item || seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return out
}

/** 从被捕获的响应体里取 `aweme_list`（解析失败返回空数组，由调用方报错）。 */
export function readAwemeList(body: string): any[] {
  try {
    const json = JSON.parse(body)
    return Array.isArray(json?.aweme_list) ? json.aweme_list : []
  } catch {
    return []
  }
}
