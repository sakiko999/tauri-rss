/**
 * selectors —— 从 store 状态派生的纯查询(无 React、无副作用)。
 *
 * 视图内容 = baseFor(节点) → filter(筛选条) → 全文搜索 → sort(排序) → 窗口分页。
 * 与 new_desktop 的 store.js 派生段同构,但条目与阅读态改由 core 提供
 * (MediaItem.isUnread / isStarred 已是权威,不再另存 read/starred 映射)。
 */
import type { MediaItem, MediaKind, Subscription } from "@tauri-playground/core"
import { groupIdOf, isGroupNode, isTabNode } from "./nodes.ts"

/** 视图筛选(按节点分别记忆)。 */
export interface ViewFilter {
  kind?: MediaKind
  platform?: string
  subscriptionId?: string
  unreadOnly?: boolean
}

export type SortMode = "new" | "hot"

export interface StoreSlice {
  allItems: MediaItem[]
  subscriptions: Subscription[]
  filter: Record<string, ViewFilter>
  sort: Record<string, SortMode>
  page: Record<string, number>
  query: string
  selectedNodeId: string | null
  refreshErrors: Record<string, string>
}

export const PAGE_SIZE = 60

function isToday(ts: number | undefined, now: number): boolean {
  if (!ts) return false
  const a = new Date(ts)
  const b = new Date(now)
  a.setHours(0, 0, 0, 0)
  b.setHours(0, 0, 0, 0)
  return a.getTime() === b.getTime()
}

/** 节点 → 未筛选的基础条目集。 */
export function baseFor(s: StoreSlice, node: string | null, now: number): MediaItem[] {
  const n = node ?? "tab:all"
  if (isTabNode(n)) {
    const k = n.slice(4)
    return k === "all" ? s.allItems : s.allItems.filter((i) => i.kind === k)
  }
  if (n === "today") return s.allItems.filter((i) => isToday(i.publishedAt, now))
  if (n === "unread") return s.allItems.filter((i) => i.isUnread)
  if (n === "starred") return s.allItems.filter((i) => i.isStarred)
  // 继续:有未读完进度的条目(视频/音频/直播用 positionSec,文章用 scrollRatio)。
  // 进度由 core applyReadingState 从 reading 回填;近片尾/近结尾时 store 已清除。
  if (n === "resume")
    return s.allItems.filter((i) => (i.positionSec ?? 0) > 0 || (i.scrollRatio ?? 0) > 0)
  if (isGroupNode(n)) {
    const gid = groupIdOf(n)
    const ids = new Set(s.subscriptions.filter((sub) => sub.groupId === gid).map((sub) => sub.id))
    return s.allItems.filter((i) => ids.has(i.subscriptionId))
  }
  if (n.startsWith("play:")) return s.allItems // 播放页内容来自 store 自身查找
  // 短视频:`short:<kind>` / `short:all` —— 只取**可播**条目(video/audio/live)。
  if (n.startsWith("short:")) {
    const k = n.slice(6)
    const playable = s.allItems.filter((i) => i.kind === "video" || i.kind === "audio" || i.kind === "live")
    return k === "all" ? playable : playable.filter((i) => i.kind === k)
  }
  return s.allItems.filter((i) => i.subscriptionId === n)
}

/** 热度排序键:播放量 → 在线人数 → 点赞数(社交)。 */
export function heatOf(i: MediaItem): number {
  const any = i as { views?: number; online?: number; likes?: number | string }
  if (any.views) return any.views
  if (any.online) return any.online
  if (any.likes) return Number(String(any.likes).replace(/\D/g, "")) || 0
  return 0
}

export function sortItems(list: MediaItem[], mode: SortMode): MediaItem[] {
  const cp = list.slice()
  if (mode === "hot") cp.sort((a, b) => heatOf(b) - heatOf(a))
  else cp.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
  return cp
}

export interface ViewResult {
  list: MediaItem[]
  /** 筛选+搜索后的总数(分页前)。 */
  total: number
  hasMore: boolean
}

/**
 * 条目正文的可搜索文本(小写)。按对象身份缓存(WeakMap):同一 item 只剥离一次,
 * 避免每次按键对整库重复剥标签。article/social 有 content;其余用 summary 兜底。
 */
const bodyCache = new WeakMap<object, string>()
export function bodyText(i: MediaItem): string {
  const hit = bodyCache.get(i)
  if (hit !== undefined) return hit
  const content = (i as { content?: string }).content ?? ""
  const text = content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().toLowerCase()
  bodyCache.set(i, text)
  return text
}

/** 完整视图查询:base → filter → 搜索 → sort → 窗口分页。 */
export function queryView(s: StoreSlice, node: string | null, now: number): ViewResult {
  const n = node ?? "tab:all"
  let list = baseFor(s, n, now)
  const f = s.filter[n]
  if (f) {
    if (f.kind) list = list.filter((i) => i.kind === f.kind)
    // platform 只有直播/社交类条目有(ArticleItem 无该字段)。
    if (f.platform) list = list.filter((i) => (i as { platform?: string }).platform === f.platform)
    if (f.subscriptionId) list = list.filter((i) => i.subscriptionId === f.subscriptionId)
    if (f.unreadOnly) list = list.filter((i) => i.isUnread)
  }
  const q = s.query.trim().toLowerCase()
  if (q) {
    list = list.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        (i.author?.name ?? "").toLowerCase().includes(q) ||
        (i.summary ?? "").toLowerCase().includes(q) ||
        // 正文搜索(即「全文搜索」的本义)。正文 HTML 只留文本(去标签)后再匹配;
        // 剥离结果按对象缓存,避免每次按键对整库重复剥离。
        bodyText(i).includes(q),
    )
  }
  // 「继续」按最近观看时间排(lastReadAt,由 core 从 reading 回填),而非发布时间 ——
  // 否则「接着上次看」的语义丢失。缺 lastReadAt 的(理论上不该有)兜底 publishedAt。
  list =
    n === "resume"
      ? list.slice().sort((a, b) => (b.lastReadAt ?? b.publishedAt ?? 0) - (a.lastReadAt ?? a.publishedAt ?? 0))
      : sortItems(list, s.sort[n] ?? "new")
  const total = list.length
  const cap = s.page[n] ?? PAGE_SIZE
  return { list: list.slice(0, cap), total, hasMore: total > cap }
}

export function unreadCount(s: StoreSlice, node: string | null, now: number): number {
  return baseFor(s, node, now).filter((i) => i.isUnread).length
}

/** 全部 + 各 kind 的条目计数(rail 的 tab 徽标)。 */
export function kindCounts(s: StoreSlice): Record<string, number> {
  const m: Record<string, number> = { all: s.allItems.length }
  for (const i of s.allItems) m[i.kind] = (m[i.kind] ?? 0) + 1
  return m
}

/** 单订阅未读数。 */
export function subUnread(s: StoreSlice, subId: string): number {
  return s.allItems.filter((i) => i.subscriptionId === subId && i.isUnread).length
}

export type Health = "disabled" | "busy" | "stale" | "error" | "ok"

/** 订阅健康:停用 → 错误 → 正常。busy 由调用方按 loading/allLoading 注入。 */
export function healthOf(
  sub: Subscription,
  refreshErrors: Record<string, string>,
  busy: Record<string, boolean>,
): Health {
  if (!sub.enabled) return "disabled"
  if (busy[sub.id]) return "busy"
  const err = refreshErrors[sub.id]
  if (err) return err === "stale" ? "stale" : "error"
  return "ok"
}

/** 最近一次成功抓取时间(订阅 updatedAt 之后由刷新写入;此处以 updatedAt 近似)。 */
export function lastFetchedOf(sub: Subscription): number {
  return sub.updatedAt
}

export function itemsById(s: StoreSlice, id: string | null): MediaItem | null {
  if (!id) return null
  return s.allItems.find((i) => i.id === id) ?? null
}

