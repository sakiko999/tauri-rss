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
 * 三栏视图状态:selectedNodeId 统一承载 tab 节点 / smart feed / 订阅源三类节点
 *   + selectedArticleId(文章详情) + expandedGroups(分组树展开)。查询聚合见 queryView。
 */
import { create } from "zustand"
import {
  createDataLayer,
  type DataLayer,
  type MediaItem,
  type ResolvePlayback,
  type Subscription,
  type SubscriptionGroup,
} from "@tauri-playground/core"
import { TEST_SUBSCRIPTIONS } from "./subscriptions"

/** 内容 tab:all 显示全部,其余按 kind 过滤中栏。tab 是「默认视图节点」的 kind 部分。 */
export type ContentTab = "all" | "article" | "video" | "audio" | "live" | "social"
/** smart feed 特殊节点 id(非真实订阅,查询走全局聚合)。 */
export type SmartFeedId = "today" | "unread" | "starred"

export const SMART_FEED_IDS: SmartFeedId[] = ["today", "unread", "starred"]

/** 是否为 smart feed 特殊节点。 */
export function isSmartFeed(id: string | null): id is SmartFeedId {
  return id === "today" || id === "unread" || id === "starred"
}

/**
 * tab 节点 id(`tab:<kind>`)——内置视图节点,与 smart feed/订阅源同为
 * selectedNodeId 的候选。`tab:` 前缀防与订阅 id(均 `s-`)冲突。
 */
export const TAB_NODES: string[] = ["tab:all", "tab:article", "tab:video", "tab:audio", "tab:live", "tab:social"]

/** 是否为 tab 内置视图节点。 */
export function isTabNode(id: string | null): id is string {
  return !!id && id.startsWith("tab:")
}

/** tab 节点 → 顶栏标题(与 Sidebar TABS 文案一致)。 */
const TAB_TITLES: Record<string, string> = {
  all: "全部",
  article: "文章",
  video: "视频",
  audio: "音频",
  live: "直播",
  social: "社交",
}

/**
 * 当前视图标题:热搜词流(hotWord)/ tab 节点 / smart feed / 订阅源 → 真实身份。
 * 中栏(MediaList)与文章左栏(ArticleList)顶栏共用——选中「今日」时顶栏显示
 * 「今日」而非写死的「文章」。
 */
export function viewTitleFor(
  nodeId: string | null,
  subscriptions: Subscription[],
  hotWord?: { word: string; items: MediaItem[] } | null,
): string {
  if (hotWord) return `热搜：${hotWord.word}`
  if (!nodeId) return "全部"
  if (nodeId === "today") return "今日"
  if (nodeId === "unread") return "未读"
  if (nodeId === "starred") return "已星标"
  if (isTabNode(nodeId)) return TAB_TITLES[nodeId.slice(4)] ?? "内容"
  return subscriptions.find((s) => s.id === nodeId)?.title ?? "内容"
}

/**
 * 节点固有 kind(非视图专有)——App 布局分发与 queryView 共用。
 * undefined = 聚合视图(无 kind 维度),字符串 = 有 kind 维度:
 *   - tab 节点:`tab:<kind>` 自带过滤维度,`tab:all` 是聚合(展示全部)→ undefined;
 *   - smart feed(today/unread/starred):聚合查询,无 kind 维度 → undefined;
 *   - 真实订阅:channel kind(article/video/audio/live/social)。
 */
export function nodeKindOf(nodeId: string | null, subscriptions: Subscription[]): string | undefined {
  if (!nodeId) return undefined
  if (isTabNode(nodeId)) {
    const kind = nodeId.slice(4) // "tab:" → kind
    return kind === "all" ? undefined : kind
  }
  if (isSmartFeed(nodeId)) return undefined
  const sub = subscriptions.find((s) => s.id === nodeId)
  // kind 由 core DataLayer.channelKind 提供(apps 不直接碰 crawler 注册表)。
  return sub ? useDesktop.getState().dl?.channelKind(sub.channelKey) : undefined
}

/**
 * 按「选中节点」查当前视图 items。节点体系统一由 selectedNodeId 承载,
 * dispatch 按 id 前缀/裸 id 分支——未来分组(`group:<id>`)标签(`tag:<id>`)
 * 在此加分支即可,不动已选节点体系。
 */
function queryView(dl: DataLayer, nodeId: string | null, subscriptions: Subscription[]): MediaItem[] {
  // smart feed(裸 id)——全局聚合
  if (nodeId === "today") {
    return dl.store.query({ today: true })
  } else if (nodeId === "unread") {
    return dl.store.query({ unreadOnly: true })
  } else if (nodeId === "starred") {
    return dl.store.query({ starredOnly: true })
  }
  // tab 节点(前缀 tab:)——全局按 kind 过滤(nodeKindOf 把 tab:all 归一为聚合)
  if (isTabNode(nodeId)) {
    const kind = nodeKindOf(nodeId, subscriptions)
    return kind ? dl.store.all().filter((it) => it.kind === kind) : dl.store.all()
  }
  // 真实订阅(裸 id)——单源
  if (nodeId) {
    return dl.store.query({ subscriptionId: nodeId })
  }
  // null → 等价 tab:all(初始化/兜底)
  return dl.store.all()
  // TODO 下一步:group:<id> → 递归展开组下订阅 → subscriptionIds;tag:<id> → tags 命中
}

interface DesktopState {
  dl: DataLayer | null
  subscriptions: Subscription[]
  groups: SubscriptionGroup[]
  /** 当前视图聚合结果(按 selectedNodeId 派生)。 */
  items: MediaItem[]
  /** 全局全部条目(与选中节点无关)——sidebar 的 kind 计数用。 */
  allItems: MediaItem[]
  /** 选中节点:tab 节点(`tab:<kind>`)/ smart feed / 订阅 id,统一承载。 */
  selectedNodeId: string | null
  /** 文章详情选中条目。 */
  selectedArticleId: string | null
  /** 分组树展开态(纯内存)。 */
  expandedGroups: Record<string, boolean>
  loading: boolean
  refreshErrors: Record<string, string>
  /** 热搜三栏右栏:当前选中的热搜词 + 其下微博流(weibo:hot 订阅内点击词条加载)。 */
  hotWord: { word: string; items: MediaItem[] } | null
  /** 订阅是否支持分页(中栏「加载更多」显隐;select 时懒查)。 */
  canLoadMore: Record<string, boolean>
  /** 该订阅已翻到底(loadMore 返回 hasMore=false 后置位;refresh 重置)。 */
  loadMoreEnded: Record<string, boolean>
  /** 渠道真实总数(翻页渠道,如 weibo cardlistInfo.total;refresh/loadMore 时更新)。 */
  totals: Record<string, number>
  /** 分页加载中。 */
  loadingMore: boolean
  init(): Promise<void>
  select(nodeId: string | null): void
  /** 加载热搜词下的微博流(右栏显示)。无 weibo:hot 订阅时 no-op。 */
  loadHotWord(word: string): Promise<void>
  toggleGroup(groupId: string): void
  selectArticle(id: string | null): void
  refresh(id: string): Promise<void>
  refreshAll(): Promise<void>
  /** 加载更多:当前订阅翻一页(仅 hot 发现流;其余 no-op)。 */
  loadMore(): Promise<void>
  markRead(item: MediaItem): void
  toggleStar(item: MediaItem): void
  /** 懒解析视频可播流(播放时调用,按 item 自身 subscriptionId 绑定;返回流 + 弹幕能力)。 */
  resolvePlay(subscriptionId: string, itemId: string): Promise<ResolvePlayback>
  /** 懒解析直播可播流(播放时调用)。 */
  resolveLivePlay(subscriptionId: string, roomId: string): Promise<ResolvePlayback>
  /** 新增订阅(给定 channelKey + info),写入并刷新。返回新订阅 id。 */
  addSubscription(channelKey: string, title: string, info: Record<string, string>): Promise<string | null>
}

/** 渠道真实总数并入 state(undefined = 渠道不带 total,保持原样)。refresh/loadMore 共用。 */
function withTotal(
  s: Pick<DesktopState, "totals">,
  id: string,
  total: number | undefined,
): Partial<Pick<DesktopState, "totals">> {
  return total !== undefined ? { totals: { ...s.totals, [id]: total } } : {}
}

let initPromise: Promise<void> | null = null

export const useDesktop = create<DesktopState>((set, get) => {
  function refreshView(dl: DataLayer): void {
    const { selectedNodeId, subscriptions } = get()
    set({
      items: queryView(dl, selectedNodeId, subscriptions),
      // 全局统计:与选中节点无关(store 每次变更都同步,sidebar 计数恒定)。
      allItems: dl.store.all(),
    })
  }

  /** 懒查订阅是否支持分页并写 canLoadMore(仅真实订阅;已缓存短路)。 */
  function queryCanLoadMore(nodeId: string): void {
    const dl = get().dl
    if (!dl || nodeId in get().canLoadMore) return
    dl.canLoadMore(nodeId).then((ok) => {
      // 节点可能已切换,只写当前选中节点的结果。
      if (get().selectedNodeId === nodeId) {
        set((s) => ({ canLoadMore: { ...s.canLoadMore, [nodeId]: ok } }))
      }
    })
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
    allItems: [],
    // 默认选中「全部」tab——等价原 activeTab:"all"。
    selectedNodeId: "tab:all",
    selectedArticleId: null,
    expandedGroups: {},
    loading: false,
    loadingMore: false,
    refreshErrors: {},
    hotWord: null,
    canLoadMore: {},
    loadMoreEnded: {},
    totals: {},

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
        // 刷新恢复的选中节点(router /v/:id)在 dl 就绪前 select 会跳过 canLoadMore 查询
        // (select 里 `if (dl)` 早退)——这里补查,否则刷新后 Footer 分页失效。
        const nodeId = get().selectedNodeId
        if (nodeId && !isSmartFeed(nodeId) && !isTabNode(nodeId)) queryCanLoadMore(nodeId)
        await get().refreshAll()
      })()
      return initPromise
    },

    select(nodeId) {
      // 切换节点即退出热搜词流(三栏左栏选中其他节点时右栏回到该节点视图)。
      set({ selectedNodeId: nodeId, selectedArticleId: null, hotWord: null })
      const dl = get().dl
      if (dl) {
        refreshView(dl)
        // 真实订阅节点:懒查是否支持分页(决定中栏「加载更多」显隐)。tab/smart feed 不查。
        if (nodeId && !isSmartFeed(nodeId) && !isTabNode(nodeId)) queryCanLoadMore(nodeId)
      }
    },

    async loadHotWord(word) {
      const dl = get().dl
      if (!dl) return
      const hotSub = get().subscriptions.find((s) => s.channelKey === "weibo:hot")
      if (!hotSub) return
      // 先置空 items(加载态),成功后填充。
      set({ hotWord: { word, items: [] } })
      try {
        const items = await dl.resolveHotWord(hotSub.id, word)
        set({ hotWord: { word, items } })
      } catch {
        // 失败保留空列表,顶栏仍显示词,方便重试。
        set({ hotWord: { word, items: [] } })
      }
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
      const total = dl.totalOf(id)
      set((s) => ({
        loading: false,
        // 渠道真实总数(翻页渠道,weibo)更新。
        ...withTotal(s, id, total),
        // 刷新 = 新首页,分页到底标记重置(可重新翻页)。
        loadMoreEnded: result.error ? s.loadMoreEnded : { ...s.loadMoreEnded, [id]: false },
        refreshErrors: result.error
          ? { ...s.refreshErrors, [id]: result.error }
          : (() => {
              const next = { ...s.refreshErrors }
              delete next[id]
              return next
            })(),
      }))
    },

    /** 加载更多:当前订阅翻一页(仅 hot 发现流;其余订阅 no-op)。 */
    async loadMore() {
      const dl = get().dl
      const id = get().selectedNodeId
      // 重入防护:按钮点击 + IO 触底可能同时触发,loadingMore 期间直接跳过(防重复请求同页)。
      if (!dl || !id || isSmartFeed(id) || isTabNode(id) || get().loadingMore) return
      set({ loadingMore: true })
      try {
        const r = await dl.loadMore(id)
        const total = dl.totalOf(id)
        set((s) => ({
          loadingMore: false,
          ...withTotal(s, id, total),
          loadMoreEnded: r.hasMore ? s.loadMoreEnded : { ...s.loadMoreEnded, [id]: true },
        }))
        // 列表刷新靠 store 订阅(init 已挂 dl.store.subscribe → refreshView),这里不重复调。
      } catch (e) {
        // 翻页失败(如小红书风控验证码)写入 refreshErrors → 顶栏活性点红 + 错误文本可见。
        set((s) => ({
          loadingMore: false,
          refreshErrors: { ...s.refreshErrors, [id]: e instanceof Error ? e.message : String(e) },
        }))
      }
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
      // 拼 id + add + refresh 编排收敛在 core DataLayer.addSubscription。
      const id = await dl.addSubscription(channelKey, title, info)
      set({ subscriptions: await dl.subscriptions.list() })
      return id
    },
  }
})
