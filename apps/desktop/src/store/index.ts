/**
 * useDesktop —— 全局 store。持有 DataLayer + 视图状态 + 全部动作。
 *
 * 分工:
 *   - **core(DataLayer)** 是数据权威:订阅/条目/阅读态/设置/缓存;
 *   - **本 store** 是「视图状态 + 动作编排」:选中节点、筛选、分页窗口、队列、
 *     播放页瞬时态、离线开关;
 *   - **URL(react-router)** 是「视图位置」权威:nodeId 来自 path,loader 里
 *     调 select() 同步,本 store 只做镜像(见 router.tsx)。
 *
 * init() 幂等(StrictMode 双 effect 用 initPromise 去重):
 *   1. appHost 已在 main.tsx 注入
 *   2. createDataLayer()
 *   3. 首次运行写入种子订阅(store 非空则不覆盖——用户 CRUD 后的数据是权威)
 *   4. 订阅 core MediaStore 变更 → 重算视图
 *   5. refreshAll(force=false) 走 TTL 缓存,启动秒开
 */
import { create } from "zustand"
import {
  createDataLayer,
  type AppSettings,
  type DataLayer,
  type MediaItem,
  type ResolvePlayback,
  type Subscription,
  type SubscriptionGroup,
} from "@tauri-playground/core"
import { SEED_GROUPS, SEED_SUBSCRIPTIONS } from "../subscriptions.ts"
import { nodeKindOf, nodeMeta, subscriptionIdsOfGroup, type NodeMeta } from "./nodes.ts"
import {
  PAGE_SIZE,
  queryView,
  type SortMode,
  type ViewFilter,
  type ViewResult,
} from "./selectors.ts"
import { usePrefs } from "./prefs.ts"

/** social 详情弹窗载荷(点击卡片打开;xhs 异步补全 full)。 */
export interface SocialDetail {
  item: MediaItem
  full?: MediaItem | null
}

export interface Toast {
  id: number
  tone: "ok" | "warn" | "error" | "info"
  title: string
  text?: string
}

interface DesktopState {
  dl: DataLayer | null
  subscriptions: Subscription[]
  groups: SubscriptionGroup[]
  /** 全局全部条目(core store 的快照;视图查询从它派生)。 */
  allItems: MediaItem[]
  /** 当前视图的**未分页**结果(供详情/推荐等直接消费)。 */
  view: ViewResult
  settings: AppSettings | null

  selectedNodeId: string | null
  selectedArticleId: string | null
  socialDetail: SocialDetail | null
  hotWord: { word: string; items: MediaItem[] } | null

  /** 展开的分组(纯内存)。 */
  openGroups: Record<string, boolean>
  filter: Record<string, ViewFilter>
  sort: Record<string, SortMode>
  page: Record<string, number>
  query: string

  /** 刷新中(全量/单订阅)。 */
  loading: boolean
  busy: Record<string, boolean>
  refreshErrors: Record<string, string>
  /** 订阅是否支持分页(懒查缓存)。 */
  canLoadMore: Record<string, boolean>
  loadMoreEnded: Record<string, boolean>
  totals: Record<string, number>
  loadingMore: boolean
  offline: boolean

  /** 命令面板开合(顶栏按钮与 ⌘K 共用同一状态)。 */
  paletteOpen: boolean
  /** 播放队列(item id)。 */
  queue: string[]
  /** 播放页取消的弹幕(设置项为总开关,此处是临时覆盖)。 */
  danmakuVisible: boolean

  toasts: Toast[]

  init(): Promise<void>
  select(nodeId: string | null): void
  loadHotWord(word: string): Promise<void>
  setQuery(q: string): void
  setFilter(node: string, patch: ViewFilter): void
  setSort(node: string, mode: SortMode): void
  growPage(node: string): void
  toggleGroup(gid: string): void
  selectArticle(id: string | null): void
  openSocialDetail(item: MediaItem): void
  closeSocialDetail(): void

  refresh(id: string): Promise<void>
  refreshAll(force?: boolean): Promise<void>
  loadMore(): Promise<void>
  setOffline(v: boolean): void

  markRead(item: MediaItem): void
  markAllRead(ids: string[]): void
  toggleStar(item: MediaItem): void

  resolvePlay(subscriptionId: string, itemId: string): Promise<ResolvePlayback>
  resolveLivePlay(subscriptionId: string, roomId: string): Promise<ResolvePlayback>

  addSubscription(channelKey: string, title: string, info: Record<string, string>): Promise<string | null>
  updateSubscription(id: string, patch: Partial<Omit<Subscription, "id">>): Promise<void>
  removeSubscription(id: string): Promise<void>
  toggleSubEnabled(id: string): Promise<void>
  addGroup(title: string): Promise<string | null>
  renameGroup(id: string, title: string): Promise<void>
  removeGroup(id: string): Promise<void>
  setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void>

  setPaletteOpen(open: boolean): void
  addToQueue(id: string): void
  clearQueue(): void
  toggleDanmaku(): void

  toast(tone: Toast["tone"], title: string, text?: string): void
  dismissToast(id: number): void
}

const now = () => Date.now()
let initPromise: Promise<void> | null = null
let toastSeq = 0

/**
 * 把「渲染管线要直读的设置」同步到宿主门面。
 *
 * 为什么走门面而不是 props:`MediaImage` 在 `packages/ui`,是任意深度的树节点,
 * 为一两个开关层层传参会污染所有中间组件的 props。这类「全局渲染开关」走
 * appHost 更短。目前只有 imageProxy(弹幕开关是 player props,不在此)。
 */
function applyRuntimeSettings(s: AppSettings): void {
  const host = globalThis.appHost as { imageProxy?: boolean; dataSaver?: boolean }
  host.imageProxy = s.imageProxy
  host.dataSaver = s.dataSaver
}

export const useDesktop = create<DesktopState>((set, get) => {
  /** 重算当前视图 + 全局条目快照。 */
  function refreshView(): void {
    const s = get()
    if (!s.dl) return
    const slice = {
      allItems: s.dl.store.all(),
      subscriptions: s.subscriptions,
      filter: s.filter,
      sort: s.sort,
      page: s.page,
      query: s.query,
      selectedNodeId: s.selectedNodeId,
      refreshErrors: s.refreshErrors,
    }
    set({
      allItems: slice.allItems,
      view: queryView(slice, s.selectedNodeId, now()),
    })
  }

  /** 懒查分页能力并写 canLoadMore(仅真实订阅;已缓存短路)。 */
  function queryCanLoadMore(nodeId: string): void {
    const dl = get().dl
    if (!dl || nodeId in get().canLoadMore) return
    void dl.canLoadMore(nodeId).then((ok) => {
      if (get().selectedNodeId === nodeId) {
        set((s) => ({ canLoadMore: { ...s.canLoadMore, [nodeId]: ok } }))
      }
    })
  }

  /** 真实订阅节点(非 tab/smart/group/page/play)。 */
  function isRealSub(nodeId: string | null): nodeId is string {
    if (!nodeId) return false
    if (nodeId.startsWith("tab:") || nodeId.startsWith("group:") || nodeId.startsWith("page:")) return false
    if (nodeId.startsWith("play:")) return false
    if (nodeId === "today" || nodeId === "unread" || nodeId === "starred") return false
    return !!get().subscriptions.find((s) => s.id === nodeId)
  }

  return {
    dl: null,
    subscriptions: [],
    groups: [],
    allItems: [],
    view: { list: [], total: 0, hasMore: false },
    settings: null,

    selectedNodeId: "tab:all",
    selectedArticleId: null,
    socialDetail: null,
    hotWord: null,

    openGroups: {},
    filter: {},
    sort: {},
    page: {},
    query: "",

    loading: false,
    busy: {},
    refreshErrors: {},
    canLoadMore: {},
    loadMoreEnded: {},
    totals: {},
    loadingMore: false,
    offline: false,

    paletteOpen: false,
    queue: [],
    danmakuVisible: true,
    toasts: [],

    async init() {
      if (get().dl) return
      if (initPromise) return initPromise
      initPromise = (async () => {
        const dl = createDataLayer()
        const [subs, groups, settings] = await Promise.all([
          dl.subscriptions.list(),
          dl.subscriptions.listGroups(),
          dl.settings.get(),
        ])
        // **只在首次运行(空库)写种子**:之后再启动不覆盖——用户 CRUD 后的订阅是权威。
        if (subs.length === 0 && groups.length === 0) {
          const t = now()
          for (const g of SEED_GROUPS) await dl.subscriptions.addGroup({ ...g })
          for (const s of SEED_SUBSCRIPTIONS) {
            await dl.subscriptions.add({ ...s, createdAt: t, updatedAt: t })
          }
        }
        set({
          dl,
          subscriptions: await dl.subscriptions.list(),
          groups: await dl.subscriptions.listGroups(),
          settings,
          openGroups: Object.fromEntries((await dl.subscriptions.listGroups()).map((g) => [g.id, true])),
        })
        // 把「图片隧道开关」同步到宿主门面(ui 的 MediaImage 直读,不经 React 树传参)。
        applyRuntimeSettings(settings)
        // 全量变更回调:条目/阅读态变化后重算视图。
        dl.store.subscribe(() => refreshView())
        refreshView()
        // 刷新后恢复的选中节点(router /v/:id)在 dl 就绪前 select 会跳过 canLoadMore——补查。
        const nodeId = get().selectedNodeId
        if (isRealSub(nodeId)) queryCanLoadMore(nodeId)
        // init 自动刷新走 TTL 缓存(命中零网络,启动秒开)。
        await get().refreshAll(false)
      })()
      return initPromise
    },

    select(nodeId) {
      set({ selectedNodeId: nodeId, selectedArticleId: null, hotWord: null })
      const dl = get().dl
      if (!dl) return
      refreshView()
      if (isRealSub(nodeId)) queryCanLoadMore(nodeId)
    },

    async loadHotWord(word) {
      const dl = get().dl
      if (!dl) return
      const hotSub = get().subscriptions.find((s) => s.channelKey === "weibo:hot")
      if (!hotSub) {
        get().toast("warn", "没有微博热搜订阅", "先在「发现」或「添加订阅」里订阅 weibo:hot。")
        return
      }
      set({ hotWord: { word, items: [] } })
      try {
        const items = await dl.resolveHotWord(hotSub.id, word)
        set({ hotWord: { word, items } })
      } catch (e) {
        // 失败保留空列表,顶栏仍显示词,方便重试。
        set({ hotWord: { word, items: [] } })
        get().toast("error", `热搜「${word}」加载失败`, e instanceof Error ? e.message : String(e))
      }
    },

    setQuery(q) {
      set({ query: q })
      refreshView()
    },

    setFilter(node, patch) {
      set((s) => ({ filter: { ...s.filter, [node]: { ...s.filter[node], ...patch } } }))
      refreshView()
    },

    setSort(node, mode) {
      set((s) => ({ sort: { ...s.sort, [node]: mode } }))
      refreshView()
    },

    growPage(node) {
      set((s) => ({ page: { ...s.page, [node]: (s.page[node] ?? PAGE_SIZE) + PAGE_SIZE } }))
      refreshView()
    },

    toggleGroup(gid) {
      set((s) => ({ openGroups: { ...s.openGroups, [gid]: !s.openGroups[gid] } }))
    },

    selectArticle(id) {
      set({ selectedArticleId: id })
    },

    openSocialDetail(item) {
      // 先展示列表数据(bili/weibo 已完整;xhs 缺详情),再异步补全。
      set({ socialDetail: { item, full: null } })
      const dl = get().dl
      if (!dl || item.kind !== "social") return
      void dl
        .resolveSocialDetail(item.subscriptionId, item.id)
        .then((full) =>
          set((s) => (s.socialDetail?.item.id === item.id ? { socialDetail: { ...s.socialDetail, full } } : s)),
        )
        .catch(() => {})
    },

    closeSocialDetail() {
      set({ socialDetail: null })
    },

    async refresh(id) {
      const dl = get().dl
      if (!dl) return
      if (get().offline) {
        get().toast("warn", "离线模式", "已跳过网络抓取;显示的是本地缓存内容。")
        return
      }
      set((s) => ({ busy: { ...s.busy, [id]: true } }))
      // 手动「刷新当前」→ 强制绕过 TTL(用户显式点刷 = 期望最新)。
      const result = await dl.refresh(id, { force: true })
      const total = dl.totalOf(id)
      const title = get().subscriptions.find((s) => s.id === id)?.title ?? id
      set((s) => {
        const busy = { ...s.busy }
        delete busy[id]
        return {
          busy,
          ...(total !== undefined ? { totals: { ...s.totals, [id]: total } } : {}),
          loadMoreEnded: result.error ? s.loadMoreEnded : { ...s.loadMoreEnded, [id]: false },
          refreshErrors: result.error
            ? { ...s.refreshErrors, [id]: result.error }
            : (() => {
                const next = { ...s.refreshErrors }
                delete next[id]
                return next
              })(),
        }
      })
      if (result.error) {
        get().toast("error", `刷新失败：${title}`, `${result.error}\n旧缓存已保留展示,不会出现内容空窗。`)
      } else {
        get().toast("ok", `已更新 ${title}`, `${result.itemCount} 条。TTL 内的订阅直接复用缓存,未发起网络请求。`)
      }
      refreshView()
    },

    async refreshAll(force = true) {
      const dl = get().dl
      if (!dl) return
      if (get().offline) {
        get().toast("warn", "离线模式", "已跳过网络抓取;显示的是本地缓存内容。")
        return
      }
      const subs = await dl.subscriptions.list()
      set({ loading: true, busy: Object.fromEntries(subs.map((s) => [s.id, true])) })
      const results = await Promise.all(subs.map((s) => dl.refresh(s.id, { force })))
      const errors: Record<string, string> = {}
      for (const r of results) if (r.error) errors[r.subscriptionId] = r.error
      set({ loading: false, busy: {}, refreshErrors: errors })
      const failed = Object.keys(errors).length
      get().toast(
        failed ? "warn" : "ok",
        failed ? `刷新完成，${failed} 条失败` : "刷新完成",
        failed ? "失败订阅保留了旧缓存,rail 上有告警标记。" : `${subs.length} 条订阅已更新。`,
      )
      refreshView()
    },

    async loadMore() {
      const dl = get().dl
      const id = get().selectedNodeId
      // 重入防护:按钮点击 + 触底 IO 可能同时触发。
      if (!dl || !id || !isRealSub(id) || get().loadingMore) return
      set({ loadingMore: true })
      try {
        const r = await dl.loadMore(id)
        const total = dl.totalOf(id)
        set((s) => ({
          loadingMore: false,
          ...(total !== undefined ? { totals: { ...s.totals, [id]: total } } : {}),
          loadMoreEnded: r.hasMore ? s.loadMoreEnded : { ...s.loadMoreEnded, [id]: true },
        }))
        refreshView() // store 订阅也会触发,但 loadMore 只有 hasMore 变化时需要
      } catch (e) {
        // 翻页失败(如小红书风控验证码)写入 refreshErrors → 顶栏活性点红。
        set((s) => ({
          loadingMore: false,
          refreshErrors: { ...s.refreshErrors, [id]: e instanceof Error ? e.message : String(e) },
        }))
      }
    },

    setOffline(v) {
      set({ offline: v })
      get().toast(v ? "warn" : "ok", v ? "已切到离线模式" : "已恢复在线", v ? "刷新会被跳过,只读本地缓存。" : undefined)
    },

    markRead(item) {
      const dl = get().dl
      if (!dl) return
      const next = !item.isUnread
      dl.store.patch(item.id, { isUnread: next })
      void dl.reading.markRead(item.id, next)
    },

    markAllRead(ids) {
      const dl = get().dl
      if (!dl) return
      for (const id of ids) {
        dl.store.patch(id, { isUnread: false })
        void dl.reading.markRead(id, true)
      }
    },

    toggleStar(item) {
      const dl = get().dl
      if (!dl) return
      const next = !item.isStarred
      dl.store.patch(item.id, { isStarred: next })
      // ⚠️ 必须落库:refresh 会整批重建条目(isStarred 默认 false),只 patch 内存
      // 的话刷新/重启后星标就丢了(core 侧 refresh 会用 reading 回填)。
      void dl.reading.setStarred(item.id, next)
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
      const id = await dl.addSubscription(channelKey, title, info)
      set({ subscriptions: await dl.subscriptions.list() })
      refreshView()
      get().toast("ok", `已订阅 ${title}`, `渠道 ${channelKey}`)
      return id
    },

    async updateSubscription(id, patch) {
      const dl = get().dl
      if (!dl) return
      await dl.subscriptions.update(id, patch)
      set({ subscriptions: await dl.subscriptions.list() })
      refreshView()
    },

    async removeSubscription(id) {
      const dl = get().dl
      if (!dl) return
      const title = get().subscriptions.find((s) => s.id === id)?.title ?? id
      await dl.subscriptions.remove(id)
      set({ subscriptions: await dl.subscriptions.list() })
      if (get().selectedNodeId === id) set({ selectedNodeId: "tab:all" })
      refreshView()
      get().toast("ok", `已退订 ${title}`)
    },

    async toggleSubEnabled(id) {
      const dl = get().dl
      if (!dl) return
      const sub = get().subscriptions.find((s) => s.id === id)
      if (!sub) return
      await dl.subscriptions.update(id, { enabled: !sub.enabled })
      set({ subscriptions: await dl.subscriptions.list() })
    },

    async addGroup(title) {
      const dl = get().dl
      if (!dl) return null
      const id = `g-${now().toString(36)}`
      await dl.subscriptions.addGroup({ id, title })
      set((s) => ({ groups: [...s.groups, { id, title }], openGroups: { ...s.openGroups, [id]: true } }))
      return id
    },

    async renameGroup(id, title) {
      const dl = get().dl
      if (!dl) return
      await dl.subscriptions.updateGroup(id, { title })
      set({ groups: await dl.subscriptions.listGroups() })
      refreshView()
    },

    async removeGroup(id) {
      const dl = get().dl
      if (!dl) return
      // 成员先迁到「未分组」,再删组(否则订阅会指向不存在的组)。
      for (const s of get().subscriptions.filter((s) => s.groupId === id)) {
        await dl.subscriptions.update(s.id, { groupId: null })
      }
      await dl.subscriptions.removeGroup(id)
      set({
        subscriptions: await dl.subscriptions.list(),
        groups: await dl.subscriptions.listGroups(),
      })
      if (get().selectedNodeId === `group:${id}`) set({ selectedNodeId: "tab:all" })
      refreshView()
    },

    async setSetting(key, value) {
      const dl = get().dl
      if (!dl) return
      const next = await dl.settings.set({ [key]: value } as Partial<AppSettings>)
      set({ settings: next })
      // 渲染管线直读的门面开关(如 imageProxy)同步生效,不必等重挂载。
      applyRuntimeSettings(next)
    },

    setPaletteOpen(open) {
      set({ paletteOpen: open })
    },

    addToQueue(id) {
      set((s) => (s.queue.includes(id) ? s : { queue: [...s.queue, id] }))
    },

    clearQueue() {
      set({ queue: [] })
    },

    toggleDanmaku() {
      set((s) => ({ danmakuVisible: !s.danmakuVisible }))
    },

    toast(tone, title, text) {
      const id = ++toastSeq
      set((s) => ({ toasts: [...s.toasts, { id, tone, title, text }] }))
      setTimeout(() => get().dismissToast(id), 4200)
    },

    dismissToast(id) {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    },
  }
})

/** 便捷:节点元信息(组件里用,避免各自重复拼参数)。 */
export function useNodeMeta(nodeId: string | null): NodeMeta {
  const subscriptions = useDesktop((s) => s.subscriptions)
  const groups = useDesktop((s) => s.groups)
  const dl = useDesktop((s) => s.dl)
  return nodeMeta(nodeId, subscriptions, groups, (k) => dl?.channelKind(k))
}

/** 当前节点的分组成员订阅 id(分组聚合查询用)。 */
export function groupMemberIds(gid: string): string[] {
  return subscriptionIdsOfGroup(useDesktop.getState().subscriptions, gid)
}

export { nodeKindOf, usePrefs }
