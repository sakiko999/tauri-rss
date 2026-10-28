/**
 * Apple 播客目录 —— 榜单 / 搜索 / 按 id 取 feed。
 *
 * 用途:给「发现」层提供播客节目入口。Apple 目录是**元数据源**,榜单只给 `im:id`,
 * **不含 `feedUrl`** —— 要拿真正可订阅的 RSS 得多查一次 Lookup(实测确认)。
 *
 * 端点选择(2026-10-15 实测):
 *   ✅ `itunes.apple.com/{cc}/rss/toppodcasts/...`  旧 iTunes 排行榜,稳定 200
 *   ✅ `itunes.apple.com/search?media=podcast`      关键词搜节目,**直接给 feedUrl**
 *   ✅ `itunes.apple.com/lookup?id=…&entity=podcast` 按 id 取详情(含 feedUrl)
 *   ❌ `rss.applemarketingtools.com/api/v2/…`       新版官方接口,当时 **504 超时**,不可用
 *
 * 无需 cookie / 签名,普通 GET 即可(但要带 UA,裸请求会被拒)。
 */

import { httpJson } from "../../host.ts"

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

/** Apple 播客分类(固定枚举,实测全部可用)。 */
export const APPLE_PODCAST_GENRES = [
  { id: 26, label: "全部" },
  { id: 1324, label: "社会与文化" },
  { id: 1304, label: "教育" },
  { id: 1321, label: "商业" },
  { id: 1318, label: "科技" },
  { id: 1303, label: "喜剧" },
  { id: 1489, label: "新闻" },
  { id: 1512, label: "健康与健身" },
] as const

/** 归一后的节目条目(榜单 / 搜索 / Lookup 三路共用)。 */
export interface ApplePodcast {
  /** Apple 目录 id(`collectionId`)。 */
  id: number
  title: string
  author: string
  /** **可订阅的 RSS 地址**。没有它这条就没法接进 `rss:podcast` —— 会被上游过滤掉。 */
  feedUrl: string
  artwork?: string
  /** Apple 站内页(用户点开看详情)。 */
  pageUrl?: string
  genre?: string
  episodeCount?: number
}

/** 排行榜原始条目(旧 iTunes RSS 的形态很啰嗦,只取我们要的)。 */
interface ChartEntry {
  id?: { attributes?: { "im:id"?: string } }
  "im:name"?: { label?: string }
  "im:artist"?: { label?: string }
  "im:image"?: Array<{ label?: string; attributes?: { height?: string } }>
  category?: { attributes?: { label?: string } }
}

const pickArtwork = (e: ChartEntry): string | undefined => {
  // 取**最大**那张(旧接口按尺寸升序给 55/60/170)。
  const imgs = e["im:image"] ?? []
  if (!imgs.length) return undefined
  const sorted = [...imgs].sort((a, b) => Number(b.attributes?.height ?? 0) - Number(a.attributes?.height ?? 0))
  return sorted[0]?.label
}

/** 榜单(按分类 + 国家)。⚠️ 只返回条目骨架,**没有 feedUrl**。 */
async function fetchChartEntries(
  country: string,
  genreId: number,
  limit: number,
): Promise<Array<{ id: string; entry: ChartEntry }>> {
  const url = `https://itunes.apple.com/${country}/rss/toppodcasts/limit=${limit}/genre=${genreId}/json`
  const res = await httpJson<{ feed?: { entry?: ChartEntry | ChartEntry[] } }>(url, { "user-agent": UA })
  const raw = res?.feed?.entry
  const list = Array.isArray(raw) ? raw : raw ? [raw] : []
  return list
    .map((entry) => ({ id: String(entry.id?.attributes?.["im:id"] ?? "").trim(), entry }))
    .filter((x) => x.id !== "")
}

/** Lookup 原始结果。 */
interface LookupResult {
  collectionId?: number
  collectionName?: string
  artistName?: string
  feedUrl?: string
  artworkUrl600?: string
  artworkUrl100?: string
  collectionViewUrl?: string
  primaryGenreName?: string
  trackCount?: number
}

const toPodcast = (r: LookupResult): ApplePodcast | null => {
  const feedUrl = String(r.feedUrl ?? "").trim()
  // ⚠️ 没 feedUrl 的直接丢:接不进 `rss:podcast`,留着只能显示不能订阅(见文件头)。
  if (!feedUrl || !r.collectionId) return null
  return {
    id: r.collectionId,
    title: String(r.collectionName ?? "").trim(),
    author: String(r.artistName ?? "").trim(),
    feedUrl,
    artwork: r.artworkUrl600 ?? r.artworkUrl100,
    pageUrl: r.collectionViewUrl,
    genre: r.primaryGenreName,
    episodeCount: r.trackCount,
  }
}

/**
 * 按 id 批量取详情(**这一步才拿到 `feedUrl`**)。
 * ⚠️ 一次最多传几十个 id,多了 URL 会过长;调用方分批。
 */
export async function lookupApplePodcasts(ids: Array<string | number>, country = "cn"): Promise<ApplePodcast[]> {
  const clean = ids.map((i) => String(i).trim()).filter(Boolean)
  if (!clean.length) return []
  const url = `https://itunes.apple.com/lookup?id=${clean.join(",")}&entity=podcast&country=${country}`
  const res = await httpJson<{ results?: LookupResult[] }>(url, { "user-agent": UA })
  return (res?.results ?? []).map(toPodcast).filter((p): p is ApplePodcast => p !== null)
}

/**
 * 热门播客榜:先取榜单拿 id,再 Lookup 换 `feedUrl`。
 * 两步是 Apple 的接口约束,不是我们多此一举(见文件头)。
 */
export async function fetchApplePodcastChart(genreId: number, limit = 20, country = "cn"): Promise<ApplePodcast[]> {
  const entries = await fetchChartEntries(country, genreId, limit)
  if (!entries.length) return []
  const byId = new Map(
    (
      await lookupApplePodcasts(
        entries.map((e) => e.id),
        country,
      )
    ).map((p) => [p.id, p]),
  )
  // 按**榜单顺序**输出(Lookup 的返回顺序不保证与请求一致)。
  return entries
    .map((e): ApplePodcast | null => {
      const p = byId.get(Number(e.id))
      if (!p) return null
      // 榜单有更干净的封面/分类时补上(Lookup 偶尔缺 genre)。
      return { ...p, artwork: p.artwork ?? pickArtwork(e.entry), genre: p.genre ?? e.entry.category?.attributes?.label }
    })
    .filter((p): p is ApplePodcast => p !== null)
}

/** 关键词搜播客(**直接带 feedUrl**,不需要二次 Lookup)。 */
export async function searchApplePodcasts(term: string, limit = 20, country = "cn"): Promise<ApplePodcast[]> {
  const q = term.trim()
  if (!q) return []
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=podcast&entity=podcast&limit=${limit}&country=${country}`
  const res = await httpJson<{ results?: LookupResult[] }>(url, { "user-agent": UA })
  return (res?.results ?? []).map(toPodcast).filter((p): p is ApplePodcast => p !== null)
}
