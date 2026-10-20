/**
 * B 站合集 / 视频列表 / 收藏夹的参数归一化(纯函数,可单测)。
 *
 * 三类 ID 的来源 URL 在站内互不相同,且合集还允许直接粘一个视频链接(先读
 * `x/web-interface/view` 的 `data.ugc_season.id`)。网络请求不在这里 —— 本模块只做
 * 同步解析,返回「已知 ID」或「待解析的视频 ID」。
 */

function parseUrl(input: string): URL | null {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`)
  } catch {
    return null
  }
}

function isBiliHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === "bilibili.com" || host.endsWith(".bilibili.com")
}

function digits(v: string | null | undefined): string | null {
  const s = String(v ?? "").trim()
  return /^\d+$/.test(s) ? s : null
}

/** 合集引用:已知 seasonId,或需要再查一次视频详情的视频 ID(bvid / av 号)。 */
export interface BiliSeasonRef {
  seasonId?: string
  videoId?: string
}

/**
 * 合集:`2974525` / `space.bilibili.com/<mid>/channel/collectiondetail?sid=…` /
 * `?season_id=…` / 视频链接或 BV 号(后者需要联网换 seasonId)。
 */
export function parseBiliSeasonRef(input: string | null | undefined): BiliSeasonRef | null {
  const raw = String(input ?? "").trim()
  if (!raw) return null
  if (/^\d+$/.test(raw)) return { seasonId: raw }
  if (/^(BV[0-9A-Za-z]{10}|av\d+)$/i.test(raw)) return { videoId: raw }

  const url = parseUrl(raw)
  if (!url || !isBiliHost(url.hostname)) return null
  const seasonId = digits(url.searchParams.get("season_id")) ?? digits(url.searchParams.get("sid"))
  if (seasonId) return { seasonId }
  const video = /\/video\/(BV[0-9A-Za-z]{10}|av\d+)/i.exec(url.pathname)
  if (video) return { videoId: video[1] }
  return null
}

/**
 * 视频列表(series):`358495` /
 * `space.bilibili.com/<mid>/lists/<sid>?type=series` /
 * `…/channel/seriesdetail?sid=…` / `www.bilibili.com/list/<mid>?sid=…`。
 */
export function parseBiliSeriesRef(input: string | null | undefined): { seriesId: string } | null {
  const raw = String(input ?? "").trim()
  if (!raw) return null
  if (/^\d+$/.test(raw)) return { seriesId: raw }

  const url = parseUrl(raw)
  if (!url || !isBiliHost(url.hostname)) return null
  const seriesId =
    digits(url.searchParams.get("sid")) ??
    digits(url.searchParams.get("series_id")) ??
    digits(/\/lists\/(\d+)/.exec(url.pathname)?.[1])
  return seriesId ? { seriesId } : null
}

/**
 * 收藏夹:`1052622027` / `space.bilibili.com/<mid>/favlist?fid=<media_id>`。
 * ⚠️ 收藏夹页面的 `fid` 与 API 的 `media_id` 是同一个值(网页上是 20 位以上)。
 */
export function parseBiliFavlistRef(input: string | null | undefined): { mediaId: string } | null {
  const raw = String(input ?? "").trim()
  if (!raw) return null
  if (/^\d+$/.test(raw)) return { mediaId: raw }

  const url = parseUrl(raw)
  if (!url || !isBiliHost(url.hostname)) return null
  const mediaId = digits(url.searchParams.get("fid")) ?? digits(url.searchParams.get("media_id"))
  return mediaId ? { mediaId } : null
}
