/**
 * media —— 条目的图片与时间归一化。
 *
 * core 的 MediaItem 是判别联合:封面可能来自 `thumbnail`(video/live/audio)、
 * `poster`、或 `images[0].url`(social)。视图只关心「给我一个 src」,
 * 归一化收在这里,避免每个卡片各写一遍分支。
 */
import type { MediaItem } from "@tauri-playground/core"

/**
 * 图片 URL 归一。
 *
 * ⚠️ 平台 API 常返回 `http://` 封面(bilibili 的 `pic` 就是),而 Tauri 生产构建的
 * 页面是 `https://tauri.localhost` —— 混合内容会被 WebView 直接拦掉(表现为裂图)。
 * 只在**页面本身是 https** 时升级到 https(本地 dev / 纯 http 部署不动)。
 * 这些图床(hdslb/douyucdn/rpic/sinaimg)都支持 https,升级安全。
 *
 * 【未做】把这条规则下沉到 core 的 deserialize 会对每个源都生效,但要处理自建
 * http RSSHub 实例这类真·http 源;现在只解决渲染侧的混合内容。
 */
export function httpsify(url: string | undefined): string | undefined {
  if (!url) return undefined
  if (!url.startsWith("http://")) return url
  try {
    if (globalThis.location?.protocol === "https:") return `https://${url.slice(7)}`
  } catch {
    /* 非浏览器环境(SSR/测试)原样返回 */
  }
  return url
}

/** 条目主图 src(可能为空)。 */
export function mediaUrl(item: MediaItem): string | undefined {
  const it = item as {
    thumbnail?: string
    poster?: string
    images?: Array<{ url?: string }>
  }
  return httpsify(it.thumbnail || it.poster || it.images?.[0]?.url)
}

/** 条目主图宽高比(默认 16:9)。 */
export function ratioOf(item: MediaItem): number {
  const it = item as {
    aspectRatio?: number
    width?: number
    height?: number
    images?: Array<{ width?: number; height?: number }>
  }
  if (it.aspectRatio && it.aspectRatio > 0) return it.aspectRatio
  if (it.width && it.height) return it.width / it.height
  const img = it.images?.[0]
  if (img?.width && img?.height) return img.width / img.height
  return 16 / 9
}

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/** 相对时间(刚刚 / N 分钟前 / 昨天 / M 月 D 日)。 */
export function fmtAgo(ts?: number, now = Date.now()): string {
  if (!ts) return ""
  const d = now - ts
  if (d < MIN) return "刚刚"
  if (d < HOUR) return `${Math.floor(d / MIN)} 分钟前`
  if (d < DAY) return `${Math.floor(d / HOUR)} 小时前`
  if (d < 2 * DAY) return "昨天"
  if (d < 30 * DAY) return `${Math.floor(d / DAY)} 天前`
  const dt = new Date(ts)
  return `${dt.getMonth() + 1} 月 ${dt.getDate()} 日`
}

/** 完整日期(YYYY 年 M 月 D 日 HH:MM)。 */
export function fmtDate(ts?: number): string {
  if (!ts) return ""
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 秒 → m:ss / h:mm:ss。 */
export function fmtTime(sec?: number): string {
  if (sec === undefined || !Number.isFinite(sec)) return "0:00"
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const mm = String(m).padStart(2, "0")
  const ss = String(s).padStart(2, "0")
  return h ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}

/** 数字缩写:1.2w / 3.4k / 890。 */
export function fmtNum(n?: number | string): string {
  const v = typeof n === "string" ? Number(n.replace(/\D/g, "")) : n
  if (v === undefined || !Number.isFinite(v)) return ""
  if (v >= 10000) return `${(v / 10000).toFixed(v >= 100000 ? 0 : 1)}w`
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`
  return String(v)
}

/** 直播平台 → 显示名 + 品牌图标名。 */
export const PLATFORM_LABEL: Record<string, string> = {
  bilibili: "bilibili",
  douyu: "斗鱼",
  huya: "虎牙",
  douyin: "抖音",
  youtube: "YouTube",
}

/** 平台 id(直播条目用)。 */
export function platformOf(item: MediaItem): string | undefined {
  return (item as { platform?: string }).platform
}

/** 直播在线人数(仅 LiveItem)。 */
export function onlineOf(item: MediaItem): number | undefined {
  return (item as { online?: number }).online
}
