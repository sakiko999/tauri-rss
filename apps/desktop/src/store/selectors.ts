/**
 * selectors —— 从 store 状态派生的纯查询(无 React、无副作用)。
 *
 * 视图内容 = baseFor(节点) → filter(筛选条) → 全文搜索 → sort(排序) → 窗口分页。
 * 与 new_desktop 的 store.js 派生段同构,但条目与阅读态改由 core 提供
 * (MediaItem.isUnread / isStarred 已是权威,不再另存 read/starred 映射)。
 */
import type { MediaItem, MediaKind, Subscription } from "@amoeba/core"
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

/**
 * 启动过渡期:此刻**还不能**渲染真实视图 —— 唯一判据,App.tsx 与 main.tsx 共用
 * (前者据此画骨架,后者据此决定何时摘掉 index.html 里那份静态骨架)。
 *
 * ⚠️ 为什么不能用「库为空」当判据:库读到之前 `subscriptions` 与 `allItems` **都是**
 * 空数组,视图会画出「还没有订阅」「这里还没有内容」这类**假信息** —— 真机上量到
 * 它在启动后 ~660ms 闪一下(那时 SQLite 还没读完)。所以第一段判据是 `!ready`
 * (订阅/分组/设置已就位),而不是任何「空」的判断。
 *
 * 第二段:已就位但首轮抓取还在飞(首启空库时 refreshAll 要真去抓网络,实测 900ms+)
 * —— 这时库**确实**是空的,但答案还没回来,继续盖骨架。`!loading` 之后交回视图:
 * 那是真·空(源没内容 / 已停用 / 搜索无结果)。
 */
export function showSkeleton(s: {
  ready: boolean
  allItems: MediaItem[]
  loading: boolean
  subscriptions: Subscription[]
}): boolean {
  if (!s.ready) return true
  return s.allItems.length === 0 && s.loading && s.subscriptions.length > 0
}

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


/** 热度排序键:在线人数 → 点赞数(社交)。 */
export function heatOf(i: MediaItem): number {
  const any = i as { online?: number; likes?: number }
  return any.online ?? any.likes ?? 0
}

/**
 * 「新」排序用的时间键。
 *
 * ⚠️ **直播没有 `publishedAt`**,直接 `?? 0` 会把它当成 1970 全都沉底 —— 实测 210 条
 * live **无一条**有时间戳,于是「全部」里第一条 live 落在第 **112** 位(PAGE_SIZE 才 60),
 * 首屏窗口内 0 条 live → `MediaMain` 的 `hasMix` 恒假 → **「正在直播」横滑轨从来不渲染**。
 * 直播间本就该按「在线/抓到的时间」参与排序,用 `fetchedAt` 兜底即符合直觉。
 */
const timeKey = (i: MediaItem): number => i.publishedAt ?? i.fetchedAt ?? 0

export function sortItems(list: MediaItem[], mode: SortMode): MediaItem[] {
  const cp = list.slice()
  if (mode === "hot") cp.sort((a, b) => heatOf(b) - heatOf(a))
  else cp.sort((a, b) => timeKey(b) - timeKey(a))
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

