/**
 * useDesktop — zustand store。持有 DataLayer + 订阅列表 + 选中订阅的 items。
 *
 * init() 幂等(StrictMode 双 effect 用 initPromise 去重):
 *   1. 注入 appHost(已在 main.tsx 完成)
 *   2. createDataLayer()
 *   3. 幂等订阅 TEST_SUBSCRIPTIONS
 *   4. 订阅 core MediaStore(listener 无参数,全量变更 → 重查选中订阅 items)
 *   5. refreshAll
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

interface DesktopState {
  dl: DataLayer | null
  subscriptions: Subscription[]
  groups: SubscriptionGroup[]
  selectedId: string | null
  items: MediaItem[]
  loading: boolean
  refreshErrors: Record<string, string>
  init(): Promise<void>
  select(id: string | null): void
  refresh(id: string): Promise<void>
  refreshAll(): Promise<void>
  markRead(item: MediaItem): void
  toggleStar(item: MediaItem): void
  /** 懒解析视频可播流(播放时调用)。 */
  resolvePlay(subscriptionId: string, itemId: string): Promise<MediaStream[]>
  /** 懒解析直播可播流(播放时调用)。 */
  resolveLivePlay(subscriptionId: string, roomId: string): Promise<MediaStream[]>
}

let initPromise: Promise<void> | null = null

export const useDesktop = create<DesktopState>((set, get) => {
  function querySelected(dl: DataLayer, selectedId: string | null): MediaItem[] {
    if (!selectedId) return []
    return dl.store.query({ subscriptionId: selectedId })
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
    selectedId: null,
    items: [],
    loading: false,
    refreshErrors: {},

    async init() {
      if (get().dl) return
      if (initPromise) return initPromise
      initPromise = (async () => {
        const dl = createDataLayer()
        set({ groups: await dl.subscriptions.listGroups() })
        await ensureSubscriptions(dl)
        // 全量变更回调:重查选中订阅 items
        dl.store.subscribe(() => {
          set({ items: querySelected(dl, get().selectedId) })
        })
        set({ dl })
        await get().refreshAll()
      })()
      return initPromise
    },

    select(id) {
      set({ selectedId: id })
      const dl = get().dl
      if (dl) set({ items: querySelected(dl, id) })
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
  }
})
