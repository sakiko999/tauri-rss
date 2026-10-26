/**
 * media —— 条目的图片与时间归一化。
 *
 * core 的 MediaItem 是判别联合:封面可能来自 `thumbnail`(video/live/audio)、
 * `poster`、或 `images[0].url`(social)。视图只关心「给我一个 src」,
 * 归一化收在这里,避免每个卡片各写一遍分支。
 */
import { itemRefKey } from "@amoeba/core"
import type { MediaItem } from "@amoeba/core"

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

/**
 * 真·在播：`kind === "live"` 且不是明确的 `offline`。
 *
 * ⚠️ twitch / YouTube 会为**已下播**的频道保留条目（`liveStatus: "offline"`，标题带
 * 「（离线）」），目的是「下播后订阅不空」、详情页显示「已下播」——这是设计，不是脏数据。
 * 但「正在直播」区块只该收在播房间，否则离线房间会被写进「N 个房间」。
 * `unknown`（老数据没写 liveStatus）按在播处理，保持原行为。
 */
export function isLiveNow(item: MediaItem): boolean {
  return item.kind === "live" && item.liveStatus !== "offline"
}

/** 条目主图 src(可能为空)。index 指定社交图集里的第几张。 */
export function mediaUrl(item: MediaItem, index = 0): string | undefined {
  const it = item as {
    thumbnail?: string
    poster?: string
    images?: Array<{ url?: string }>
  }
  return httpsify(it.images?.[index]?.url || it.thumbnail || it.poster)
}

/**
 * 瀑布流封面比例下限(宽/高)。超长竖图(长截图/拼图)按真实比例铺会把一列拉得
 * 极长,限到 0.66(≈2:3)。详情弹窗用 object-fit:contain 不受此限,完整显示原图。
 */
export const MIN_COVER_RATIO = 0.66

/** 社交图宽高比(宽/高);宽高未知退化 4:5,竖图抬到 MIN_COVER_RATIO。 */
export function socialRatio(img?: { width?: number; height?: number }): number {
  const r = img?.width && img?.height ? img.width / img.height : 4 / 5
  return Math.max(r, MIN_COVER_RATIO)
}

/**
 * 列表 key —— **必须**带 subscriptionId。
 *
 * `MediaItem.id` 只在**订阅内**唯一(直播房号 / RSS guid),而 tab:all / tab:live /
 * 智能节点 / 分组 这些聚合视图会把多个订阅的条目混在一个列表里。同一个房间同时被
 * 「手填房间订阅」和「平台热门榜」命中时(实测 bilibili:7734200 同时出现在
 * `bili:live`(roomIds=6 解析成该房)与 `bili:live:hot`),纯 id 就撞 key ——
 * React 会报「two children with the same key」并导致条目重复/丢渲染。
 *
 * ⚠️ masonic 会**用同一回调按数组下标兜底**(`defaultGetItemKey(_, i) => i`):
 * 渲染路径传 item,但测量/滑窗路径会直接把**下标**当 key。所以第二参必填下标 ——
 * 否则真 item 的 key 变成 `"undefined:undefined"`(同一串给所有 cell)。
 * 同时挡掉非对象入参(异常时 `items[index]` 为 undefined)。
 */
export function itemKey(item: MediaItem | undefined | null, index = 0): string {
  // 非 item(测量阶段的下标入参 / 越界 undefined)→ 用下标,保证唯一且稳定。
  if (!item || typeof item !== "object" || !("id" in item)) return `#${index}`
  return itemRefKey(item.subscriptionId, item.id)
}

/**
 * 列表摘要 —— 去掉 URL 噪声后仍够长才返回,否则返回空(不渲染)。
 *
 * ⚠️ 很多源(Hacker News 系、部分 RSSHub 路由)的 `description` 就是
 * 「Article URL: <链接> Comments URL: <链接> Points: 3」这类模板,剥掉 HTML 后
 * 剩下的仍是链接复读。把这种当摘要显示,等于在标题下面又印一遍 URL,纯噪声。
 * 规则:删掉 URL/裸域名后可见文字不足 8 个字 → 认为没有可用摘要。
 */
export function excerptOf(item: MediaItem): string {
  const raw = (item.summary ?? "").trim()
  if (!raw) return ""
  // 链接聚合类源的固定模板(HN 系 / Reddit 系)——剥掉 URL 后剩「Article URL:
  // Comments URL: Points: 3」这种标签串,仍然不是可读摘要,整条丢掉。
  if (/\b(article url|comments url|submitted by)\b|(^|\s)(points|#\s*comments):/i.test(raw)) return ""
  const stripped = raw
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\bwww\.\S+/gi, "")
    .replace(/\b[\w-]+\.(com|org|net|io|dev|cn|co|me|ai|news|blog)\b\S*/gi, "")
    .replace(/\s+/g, " ")
    .trim()
  return stripped.length >= 8 ? raw : ""
}

/** 条目主图原始宽度(px);未知返回 Infinity —— 未知不该被门槛挡掉。 */
export function heroWidth(item: MediaItem): number {
  const it = item as { width?: number; images?: Array<{ width?: number }> }
  return it.width ?? it.images?.[0]?.width ?? Infinity
}

/** 条目主图宽高比(默认 16:9)。 */export function ratioOf(item: MediaItem): number {
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
  bilibili: "B站",
  douyu: "斗鱼",
  huya: "虎牙",
  douyin: "抖音",
  youtube: "YouTube",
  twitch: "Twitch",
}

/** 平台 id(直播条目用)。 */
export function platformOf(item: MediaItem): string | undefined {
  return (item as { platform?: string }).platform
}

/** 直播在线人数(仅 LiveItem)。 */
export function onlineOf(item: MediaItem): number | undefined {
  return (item as { online?: number }).online
}
