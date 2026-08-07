/**
 * useDesktop — zustand store。持有 DataLayer + 三栏阅读器 UI 状态。
 *
 * init() 幂等(StrictMode 双 effect 用 initPromise 去重):
 *   1. 注入 appHost(已在 main.tsx 完成)
 *   2. createDataLayer()
 *   3. 幂等订阅 TEST_SUBSCRIPTIONS
 *   4. 订阅 core MediaStore(listener 无参数,全量变更 → 重查当前视图 items)
 *   5. refreshAll
 *
 * 三栏视图状态:activeTab(kind 过滤) + selectedNodeId(订阅 or smart feed)
 *   + selectedArticleId(文章详情) + expandedGroups(分组树展开)。查询聚合见 queryView。
 */
import { create } from "zustand"
import {
  createDataLayer,
  type DataLayer,
  type MediaItem,
  type MediaStream,
  type Subscription,
  type SubscriptionGroup,
} from "@tauri-playground/core"
import { TEST_SUBSCRIPTIONS } from "./subscriptions"

/** 内容 tab:all 显示全部,其余按 kind 过滤中栏。 */
export type ContentTab = "all" | "article" | "video" | "audio" | "live" | "social"
/** smart feed 特殊节点 id(非真实订阅,查询走全局聚合)。 */
export type SmartFeedId = "today" | "unread" | "starred"

export const SMART_FEED_IDS: SmartFeedId[] = ["today", "unread", "starred"]

/** 是否为 smart feed 特殊节点。 */
export function isSmartFeed(id: string | null): id is SmartFeedId {
  return id === "today" || id === "unread" || id === "starred"
}

/** 按「选中节点 + tab」查当前视图 items。 */
function queryView(dl: DataLayer, nodeId: string | null, activeTab: ContentTab): MediaItem[] {
  let items: MediaItem[]
  if (nodeId === "today") {
    items = dl.store.query({ today: true })
  } else if (nodeId === "unread") {
    items = dl.store.query({ unreadOnly: true })
  } else if (nodeId === "starred") {
    items = dl.store.query({ starredOnly: true })
  } else if (nodeId) {
    items = dl.store.query({ subscriptionId: nodeId })
  } else {
    items = dl.store.all()
  }
  return activeTab === "all" ? items : items.filter((it) => it.kind === activeTab)
}

interface DesktopState {
  dl: DataLayer | null
  subscriptions: Subscription[]
  groups: SubscriptionGroup[]
  /** 当前视图聚合结果(按 selectedNodeId + activeTab 派生)。 */
  items: MediaItem[]
  /** 选中节点:订阅 id 或 smart feed id(today/unread/starred)。 */
  selectedNodeId: string | null
  /** 文章详情选中条目。 */
  selectedArticleId: string | null
  /** kind 过滤 tab。 */
  activeTab: ContentTab
  /** 分组树展开态(纯内存)。 */
  expandedGroups: Record<string, boolean>
  loading: boolean
  refreshErrors: Record<string, string>
  init(): Promise<void>
  select(nodeId: string | null): void
  setActiveTab(tab: ContentTab): void
  toggleGroup(groupId: string): void
  selectArticle(id: string | null): void
  refresh(id: string): Promise<void>
  refreshAll(): Promise<void>
  markRead(item: MediaItem): void
  toggleStar(item: MediaItem): void
  /** 懒解析视频可播流(播放时调用,按 item 自身 subscriptionId 绑定)。 */
  resolvePlay(subscriptionId: string, itemId: string): Promise<MediaStream[]>
  /** 懒解析直播可播流(播放时调用)。 */
  resolveLivePlay(subscriptionId: string, roomId: string): Promise<MediaStream[]>
  /** 新增订阅(给定 channelKey + info),写入并刷新。返回新订阅 id。 */
  addSubscription(channelKey: string, title: string, info: Record<string, string>): Promise<string | null>
}

let initPromise: Promise<void> | null = null

export const useDesktop = create<DesktopState>((set, get) => {
  function refreshView(dl: DataLayer): void {
    set({ items: queryView(dl, get().selectedNodeId, get().activeTab) })
  }

  /**
   * 种子订阅同步:本地与 TEST_SUBSCRIPTIONS 对齐。
   *   - 缺的补上;
   *   - 多余的删掉(测试种子是权威;处理旧数据残留如 channelKey 改名的 bili:hot)。
   */
  async function ensureSubscriptions(dl: DataLayer): Promise<void> {
    const existing = await dl.subscriptions.list()
    const seedIds = new Set(TEST_SUBSCRIPTIONS.map((s) => s.id))
    const t = Date.now()
    // 删多余
    for (const s of existing) {
      if (!seedIds.has(s.id)) await dl.subscriptions.remove(s.id)
    }
    // 补缺失
    const current = await dl.subscriptions.list()
    const existingIds = new Set(current.map((s) => s.id))
    for (const sub of TEST_SUBSCRIPTIONS) {
      if (existingIds.has(sub.id)) continue
      await dl.subscriptions.add({ ...sub, createdAt: t, updatedAt: t })
    }
    set({ subscriptions: await dl.subscriptions.list() })
  }

  return {
    dl: null,
    subscriptions: [],
    groups: [],
    items: [],
    selectedNodeId: null,
    selectedArticleId: null,
    activeTab: "all",
    expandedGroups: {},
    loading: false,
    refreshErrors: {},

    async init() {
      if (get().dl) return
      if (initPromise) return initPromise
      initPromise = (async () => {
        const dl = createDataLayer()
        // bilibili 登录 cookie 默认值在 core 层(DEFAULT_SETTINGS.bilibiliCookie),
        // 前端无需注入;settings 持久化值 / 订阅级 info.cookie 优先。
        set({ groups: await dl.subscriptions.listGroups() })
        await ensureSubscriptions(dl)
        // 全量变更回调:重查当前视图 items
        dl.store.subscribe(() => refreshView(dl))
        set({ dl })
        await get().refreshAll()
      })()
      return initPromise
    },

    select(nodeId) {
      set({ selectedNodeId: nodeId, selectedArticleId: null })
      const dl = get().dl
      if (dl) refreshView(dl)
    },

    setActiveTab(tab) {
      set({ activeTab: tab })
      const dl = get().dl
      if (dl) refreshView(dl)
    },

    toggleGroup(groupId) {
      set((s) => ({ expandedGroups: { ...s.expandedGroups, [groupId]: !s.expandedGroups[groupId] } }))
    },

    selectArticle(id) {
      set({ selectedArticleId: id })
    },

    async refresh(id) {
      const dl = get().dl
      if (!dl) return
      set({ loading: true })
      const result = await dl.refresh(id)
      set((s) => ({
        loading: false,
        refreshErrors: result.error
          ? { ...s.refreshErrors, [id]: result.error }
          : (() => {
              const next = { ...s.refreshErrors }
              delete next[id]
              return next
            })(),
      }))
    },

    async refreshAll() {
      const dl = get().dl
      if (!dl) return
      const subs = await dl.subscriptions.list()
      set({ loading: true })
      const results = await Promise.all(subs.map((s) => dl.refresh(s.id)))
      const errors: Record<string, string> = {}
      for (const r of results) if (r.error) errors[r.subscriptionId] = r.error
      set({ loading: false, refreshErrors: errors })
    },

    markRead(item) {
      const dl = get().dl
      if (!dl) return
      dl.store.patch(item.id, { isUnread: !(item.isUnread ?? true) })
      dl.reading.markRead(item.id, !(item.isUnread ?? true))
    },

    toggleStar(item) {
      const dl = get().dl
      if (!dl) return
      dl.store.patch(item.id, { isStarred: !item.isStarred })
    },

    async resolvePlay(subscriptionId, itemId) {
      const dl = get().dl
      if (!dl) throw new Error("DataLayer 未初始化")
      return dl.resolvePlay(subscriptionId, itemId)
    },

    async resolveLivePlay(subscriptionId, roomId) {
      const dl = get().dl
      if (!dl) throw new Error("DataLayer 未初始化")
      return dl.resolveLivePlay(subscriptionId, roomId)
    },

    async addSubscription(channelKey, title, info) {
      const dl = get().dl
      if (!dl) return null
      const id = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      const t = Date.now()
      await dl.subscriptions.add({ id, channelKey, title, enabled: true, info, createdAt: t, updatedAt: t })
      set({ subscriptions: await dl.subscriptions.list() })
      await get().refresh(id)
      return id
    },
  }
})
