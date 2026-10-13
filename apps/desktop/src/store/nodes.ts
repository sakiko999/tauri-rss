/**
 * 节点语法 —— 把 URL 的 nodeId 解析成「视图意图」。
 *
 * nodeId 形态(全部由 selectedNodeId 承载,不引入新的路由段):
 *   tab:all|article|video|audio|live|social   内置内容类型
 *   today / unread / starred                  智能订阅(全局聚合)
 *   s-*                                       真实订阅(裸 id,不加前缀以避免重命名)
 *   group:<gid>                               分组聚合
 *   page:discover / page:settings / page:account  页面
 *
 * nodeMeta 返回的 type 驱动外壳布局(reader 三栏 / media 网格 / page 整页),
 * 对应 new_desktop 的 store.js nodeMeta。
 */
import type { MediaItem, MediaKind, Subscription, SubscriptionGroup } from "@tauri-playground/core"

/** 内容 tab:all 显示全部,其余按 kind 过滤。 */
export type ContentTab = "all" | MediaKind
/** smart feed 特殊节点 id(非真实订阅,查询走全局聚合)。 */
export type SmartFeedId = "today" | "unread" | "starred" | "resume"
/** 页面节点 id。 */
export type PageId = "discover" | "settings" | "account"
/** 视图意图:阅读三栏 / 网格 / 热搜(词条栏+词流) / 整页 / 播放页 / 短视频全屏流。 */
export type NodeType = "reader" | "media" | "hot" | "page" | "player" | "shortvideo"

export interface KindMeta {
  label: string
  /** lucide 图标名(见 components/Icon.tsx 的映射表)。 */
  icon: string
}

export const KIND_META: Record<MediaKind, KindMeta> = {
  article: { label: "文章", icon: "rss" },
  video: { label: "视频", icon: "play" },
  audio: { label: "音频", icon: "music" },
  live: { label: "直播", icon: "radio" },
  social: { label: "社交", icon: "message" },
}

export const KIND_ORDER: MediaKind[] = ["article", "video", "audio", "live", "social"]

/** 内容类型 tab(全部 + 5 个 kind)。 */
export const TABS: Array<{ id: ContentTab; label: string; icon: string }> = [
  { id: "all", label: "全部", icon: "layers" },
  ...KIND_ORDER.map((k) => ({ id: k as ContentTab, label: KIND_META[k].label, icon: KIND_META[k].icon })),
]

/** 智能订阅。 */
export const SMART: Array<{ id: SmartFeedId; label: string; icon: string }> = [
  { id: "today", label: "今日", icon: "clock" },
  { id: "unread", label: "未读", icon: "inbox" },
  { id: "starred", label: "已星标", icon: "star" },
  { id: "resume", label: "继续", icon: "play" },
]

/** 短视频模式入口(第三模式):按 kind 分。只列有短片体感的 video/live。 */
export const SHORT_MODES: Array<{ kind: ContentTab; label: string; icon: string }> = [
  { kind: "video", label: "短视频", icon: "play" },
  { kind: "live", label: "直播流", icon: "radio" },
]

/** 页面节点(rail-foot 三项)。 */
export const PAGES: Array<{ id: string; label: string; icon: string }> = [
  { id: "page:discover", label: "发现", icon: "compass" },
  { id: "page:account", label: "账号与凭证", icon: "lock" },
  { id: "page:settings", label: "设置", icon: "settings" },
]

export const DEFAULT_VIEW = "tab:all"

export function isTabNode(id: string | null): boolean {
  return !!id && id.startsWith("tab:")
}

export function isSmartFeed(id: string | null): id is SmartFeedId {
  return id === "today" || id === "unread" || id === "starred" || id === "resume"
}

export function isGroupNode(id: string | null): boolean {
  return !!id && id.startsWith("group:")
}

export function isPageNode(id: string | null): boolean {
  return !!id && id.startsWith("page:")
}

export function isPlayNode(id: string | null): boolean {
  return !!id && id.startsWith("play:")
}

/**
 * 短视频模式节点:`short:<kind>`(如 `short:video` / `short:all`)—— 可播条目的
 * 上下滑全屏流(第三模式)。⚠️ 用 `short:` 前缀(比 `page:` 语义更贴:**带 kind 维度**,
 * 且是「内容流」而非「管理页」)。
 */
export function isShortNode(id: string | null): boolean {
  return !!id && id.startsWith("short:")
}

/** 分组节点 → 组 id。 */
export function groupIdOf(id: string): string | null {
  return isGroupNode(id) ? id.slice(6) : null
}

/** 页面节点 → 页 id。 */
export function pageIdOf(id: string): PageId | null {
  if (!isPageNode(id)) return null
  const p = id.slice(5)
  return p === "discover" || p === "settings" || p === "account" ? (p as PageId) : null
}

/** 节点固有 kind(无 kind 维度 = undefined:tab:all / smart feed / 分组 / 页面)。 */
export function nodeKindOf(
  id: string | null,
  subscriptions: Subscription[],
  channelKind: (channelKey: string) => MediaKind | undefined,
): MediaKind | undefined {
  if (!id) return undefined
  if (isTabNode(id)) {
    const k = id.slice(4)
    return k === "all" ? undefined : (k as MediaKind)
  }
  const sub = subscriptions.find((s) => s.id === id)
  return sub ? channelKind(sub.channelKey) : undefined
}

export interface NodeMeta {
  node: string
  sub: Subscription | null
  group: SubscriptionGroup | null
  kind: MediaKind | null
  title: string
  icon: string
  type: NodeType
}

/**
 * 节点 → 视图元信息。type 决定外壳布局:
 *   reader = 列表栏 + 正文主区(文章类);media = 单栏网格;page = 整页;player = 播放页。
 */
export function nodeMeta(
  id: string | null,
  subscriptions: Subscription[],
  groups: SubscriptionGroup[],
  channelKind: (channelKey: string) => MediaKind | undefined,
): NodeMeta {
  const n = id ?? DEFAULT_VIEW
  const base: NodeMeta = { node: n, sub: null, group: null, kind: null, title: "内容", icon: "layers", type: "media" }

  if (isPlayNode(n)) return { ...base, title: "播放", icon: "play", type: "player" }

  if (isShortNode(n)) {
    const k = n.slice(6) // short: 之后
    const meta = k === "all" ? null : KIND_META[k as MediaKind]
    return {
      ...base,
      kind: k === "all" ? null : (k as MediaKind),
      title: meta ? `${meta.label} · 短视频` : "短视频",
      icon: "play",
      type: "shortvideo",
    }
  }

  if (isPageNode(n)) {
    const p = pageIdOf(n)
    if (p === "discover") return { ...base, title: "发现", icon: "compass", type: "page" }
    if (p === "settings") return { ...base, title: "设置", icon: "settings", type: "page" }
    if (p === "account") return { ...base, title: "账号与凭证", icon: "lock", type: "page" }
    return { ...base, title: "页面", type: "page" }
  }

  if (isTabNode(n)) {
    const k = n.slice(4)
    if (k === "all") return { ...base, title: "全部内容", icon: "layers" }
    const meta = KIND_META[k as MediaKind]
    return {
      ...base,
      kind: k as MediaKind,
      title: meta?.label ?? "内容",
      icon: meta?.icon ?? "layers",
      // 文章 tab 走阅读三栏,其余走网格。
      type: k === "article" ? "reader" : "media",
    }
  }

  if (isSmartFeed(n)) {
    const hit = SMART.find((s) => s.id === n)
    return { ...base, title: hit?.label ?? "内容", icon: hit?.icon ?? "layers" }
  }

  if (isGroupNode(n)) {
    const gid = groupIdOf(n)
    const group = groups.find((g) => g.id === gid) ?? null
    return { ...base, group, title: group?.title ?? "分组" }
  }

  const sub = subscriptions.find((s) => s.id === n) ?? null
  if (sub) {
    const kind = channelKind(sub.channelKey) ?? null
    return {
      ...base,
      sub,
      kind,
      title: sub.title,
      icon: kind ? KIND_META[kind].icon : "rss",
      // weibo:hot 是「词条栏 + 该词内容流」的特殊两栏视图。
      type: sub.channelKey === "weibo:hot" ? "hot" : kind === "article" ? "reader" : "media",
    }
  }
  return base
}

/** 顶栏标题:热搜词流优先,其次节点自身标题。 */
export function viewTitleFor(meta: NodeMeta, hotWord?: { word: string } | null): string {
  return hotWord ? `热搜：${hotWord.word}` : meta.title
}

/** 分组聚合:该组下所有订阅 id(含未分组的 groupId=null 语义不适用)。 */
export function subscriptionIdsOfGroup(subscriptions: Subscription[], gid: string): string[] {
  return subscriptions.filter((s) => s.groupId === gid).map((s) => s.id)
}

/** 未分组的订阅。 */
export function orphanSubscriptions(subscriptions: Subscription[]): Subscription[] {
  return subscriptions.filter((s) => !s.groupId)
}

/** 同源推荐:同一订阅下的其它条目(详情页/播放页「来自同一订阅」)。 */
export function sameSourceItems(items: MediaItem[], item: MediaItem | null, limit: number): MediaItem[] {
  if (!item) return []
  return items.filter((it) => it.subscriptionId === item.subscriptionId && it.id !== item.id).slice(0, limit)
}
