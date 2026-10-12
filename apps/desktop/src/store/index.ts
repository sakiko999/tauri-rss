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
import { nodeKindOf, nodeMeta, subscriptionIdsOfGroup, type NodeMeta, type NodeType } from "./nodes.ts"
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
  /** 详情补全失败的原因(为空 = 还在补全或无需补全)。 */
  error?: string
}

/** 热搜词流:词 + 内容 + 加载/失败态(失败不能与「加载中」同态,否则永久停在转圈)。 */
export interface HotWordState {
  word: string
  items: MediaItem[]
  loading: boolean
  error?: string
}

export interface Toast {
  id: number
  tone: "ok" | "warn" | "error" | "info"
  title: string
  text?: string
  /** 可撤销操作(如「一键归组」)—— 有这组字段时吐司里出现一个动作按钮。 */
  action?: { label: string; run: () => void }
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
  hotWord: HotWordState | null
  /** DataLayer 初始化失败(库损坏/宿主未注入)→ 整页错误,不让应用白屏。 */
  initError: string | null

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

  addSubscription(
    channelKey: string,
    title: string,
    info: Record<string, string>,
    meta?: { groupId?: string | null; refreshIntervalSec?: number },
  ): Promise<string | null>
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

  toast(tone: Toast["tone"], title: string, text?: string, action?: Toast["action"]): void
  dismissToast(id: number): void
  /** 把未分组订阅按内容类型一键归入「视频 / 直播 / 社交 / 音频 / 文章」分组。返回移动条数。 */
  autoGroupByKind(): Promise<number>
}

const now = () => Date.now()

/** 订阅参数是否等价(键序无关;空值/缺省视为同义)。 */
function sameInfo(a: Record<string, string>, b: Record<string, string>): boolean {
  const norm = (o: Record<string, string>) =>
    Object.entries(o ?? {})
      .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "")
      .map(([k, v]) => `${k}=${String(v).trim()}`)
      .sort()
      .join("&")
  return norm(a) === norm(b)
}

/**
 * refreshAll 里单条订阅的硬超时。
 *
 * 大多数抓取路径已有自己的超时(Rust http_get 默认 20s;xhs 的 waitUntil 15s),
 * 但 browser 通道的 `invoke`(browser_ensure / ws_connect / ws_send)**没有超时**
 * —— 一次不回话就永久占住 withBrowserLock,后面所有浏览器操作排队到天荒地老,
 * 整轮 refreshAll 也就永不完成。这里兜最后一层。
 */
const REFRESH_TIMEOUT_MS = 45_000

/** 给单个 promise 套超时;超时以 reject 形式抛出,交给调用方按条记错。 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string, onTimeout?: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      // 只 reject 外层 promise 是不够的:被挂住的底层 invoke 仍持有浏览器锁。
      // 通知调用方做实际的中止(见 refreshAll 的 onTimeout)。
      try {
        onTimeout?.()
      } catch {
        /* 中止失败不吞掉本次超时 */
      }
      reject(new Error(`刷新超时(${Math.round(ms / 1000)}s):${label}`))
    }, ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e instanceof Error ? e : new Error(String(e)))
      },
    )
  })
}
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
    initError: null,

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
        try {
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
            initError: null,
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
        } catch (e) {
          // 初始化失败(宿主未注入 / 库损坏):置错误态由 App 渲染错误页,不让整页白屏。
          // 允许重试:清掉 initPromise 让下次 init() 重新走一遍。
          initPromise = null
          set({ initError: e instanceof Error ? e.message : String(e) })
        }
      })()
      return initPromise
    },

    select(nodeId) {
      // ⚠️ 切换节点要清搜索词:否则上一个源的搜索会静默继续过滤新源,用户看到空列表
      // 却以为新源没内容(搜索框里的词可能已经被滚出视线)。
      set({ selectedNodeId: nodeId, selectedArticleId: null, hotWord: null, query: "" })
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
      set({ hotWord: { word, items: [], loading: true } })
      try {
        const items = await dl.resolveHotWord(hotSub.id, word)
        // 竞态防护:用户可能已点了别的词,过期响应不覆盖当前词。
        if (get().hotWord?.word !== word) return
        set({ hotWord: { word, items, loading: false } })
      } catch (e) {
        if (get().hotWord?.word !== word) return
        // 失败要区别于「加载中」:否则右栏永久停在「正在取…」且没有重试入口。
        const msg = e instanceof Error ? e.message : String(e)
        set({ hotWord: { word, items: [], loading: false, error: msg } })
        get().toast("error", `热搜「${word}」加载失败`, msg)
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
        .catch((e) => {
          // 补全失败必须落进 error 态:否则弹窗永久停在骨架屏 +「正在向源站补全」。
          const msg = e instanceof Error ? e.message : String(e)
          set((s) => (s.socialDetail?.item.id === item.id ? { socialDetail: { ...s.socialDetail, error: msg } } : s))
        })
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
        // 手动刷新是 force 的,必然走网络 —— 旧文案「未发起网络请求」与实际行为不符。
        get().toast("ok", `已更新 ${title}`, `${result.itemCount} 条。已强制重新抓取,绕过内容缓存。`)
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
      // 重入防护:刷新按钮在 loading 期间未禁用(顶栏 chip / rail 刷新键),连点会并发
      // 发起多轮全量抓取 —— 反爬源被打 + 界面状态互相覆盖。
      if (get().loading) return
      const subs = await dl.subscriptions.list()
      set({ loading: true, busy: Object.fromEntries(subs.map((s) => [s.id, true])) })
      const errors: Record<string, string> = {}
      try {
        // ⚠️ 必须 allSettled + 逐条超时 + finally:
        //   - 用 Promise.all 时,任一 reject 会让下面的 set({loading:false}) **永不执行**
        //     → 顶栏「更新中」永久转圈(且 Promise.all 会丢结果,其余订阅的白抓);
        //   - 任一 promise 永不 settle(如 browser 通道 invoke 无超时)同样卡死整轮。
        // 逐条超时把「无限等待」变成「这一条报错」,finally 保证 loading 一定落回。
        const results = await Promise.allSettled(
          subs.map((s) =>
            withTimeout(dl.refresh(s.id, { force }), REFRESH_TIMEOUT_MS, s.id, () => {
              // 超时 = 大概率卡在 CDP 浏览器通道(它没有自己的超时)。中止在途调用,
              // 让持锁的 await 立刻返回错误,withBrowserLock 得以释放 —— 否则后续
              // 所有浏览器操作排队到天荒地老,下一轮刷新也起不来。
              globalThis.appHost.browser?.abortPending?.(`刷新超时:${s.id}`)
            }),
          ),
        )
        results.forEach((r, i) => {
          const id = subs[i]!.id
          if (r.status === "fulfilled") {
            if (r.value.error) errors[id] = r.value.error
          } else {
            errors[id] = r.reason instanceof Error ? r.reason.message : String(r.reason)
          }
        })
      } finally {
        set({ loading: false, busy: {}, refreshErrors: errors })
      }
      const failed = Object.keys(errors).length
      get().toast(
        failed ? "warn" : "ok",
        failed ? `刷新完成，${failed} 条失败` : "刷新完成",
        failed
          ? `失败的订阅:${Object.keys(errors)
              .map((id) => subs.find((s) => s.id === id)?.title ?? id)
              .join("、")}。已保留旧缓存,rail 上有告警标记。`
          : `${subs.length} 条订阅已更新。`,
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
      for (const id of ids) dl.store.patch(id, { isUnread: false })
      // ⚠️ 必须一次性批量落库:逐条 `void markRead` 会并发读-改-写同一张 reading blob,
      // 后写者用旧快照覆盖前者 —— N 条只落 1 条,且整张表的既有记录被抹掉。
      void dl.reading.markManyRead(ids, true)
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

    async addSubscription(channelKey, title, info, meta) {
      const dl = get().dl
      if (!dl) return null
      // ⚠️ 重复订阅拦截:同 channelKey + 同 info 再加一次,会得到两条内容完全相同的
      // 订阅 —— 未读数与条目数直接翻倍(而且两条都各自抓一遍网络)。
      // 只在**新建**时拦(并入已有订阅走的是 updateSubscription,不经过这里)。
      const dup = get().subscriptions.find(
        (s) => s.channelKey === channelKey && sameInfo(s.info, info),
      )
      if (dup) {
        get().toast("info", `已经订阅过了：${dup.title}`, "同参数重复添加会产生两份一样的内容。", {
          label: "打开",
          run: () => get().select(dup.id),
        })
        return dup.id
      }
      const id = await dl.addSubscription(channelKey, title, info, meta)
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
      // ⚠️ 必须带随机后缀:纯时间戳在同一毫秒内连点「新建分组」会撞 id,store 里出现
      // 两个同 id 分组(React key 冲突 + 持久化覆盖)。
      const id = `g-${now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
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

    async autoGroupByKind() {
      const dl = get().dl
      if (!dl) return 0
      const subs = get().subscriptions
      const orphans = subs.filter((s) => !s.groupId)
      if (!orphans.length) {
        get().toast("info", "没有未分组的订阅")
        return 0
      }
      // kind → 组名(按用户的条目实际类型,不是渠道写死的)。
      const KIND_GROUP: Record<string, string> = {
        video: "视频",
        live: "直播",
        social: "社交",
        audio: "播客",
        article: "文章",
      }
      // 1. 确保目标分组存在(按名字复用已有的,不重复建)。
      const groups = get().groups.slice()
      const groupIdOf = (name: string): string | null => {
        const hit = groups.find((g) => g.title === name)
        return hit ? hit.id : null
      }
      const ensureGroup = async (name: string): Promise<string> => {
        const existing = groupIdOf(name)
        if (existing) return existing
        const id = await get().addGroup(name)
        if (!id) throw new Error("创建分组失败")
        groups.push({ id, title: name })
        return id
      }
      // 2. 记住原分组,便于撤销。
      const before = orphans.map((s) => ({ id: s.id, groupId: s.groupId ?? null }))
      // ⚠️ 先按 kind 分桶,只为**实际有成员**的 kind 建组 —— 否则会留下 0 成员的
      // 空分组(如「文章」组建出来了却没人),用户看着像归类失败。
      const buckets = new Map<string, typeof orphans>()
      for (const s of orphans) {
        const kind = dl.channelKind(s.channelKey)
        if (!kind) continue
        const name = KIND_GROUP[kind] ?? "其它"
        const list = buckets.get(name)
        if (list) list.push(s)
        else buckets.set(name, [s])
      }
      let moved = 0
      try {
        for (const [name, members] of buckets) {
          const gid = await ensureGroup(name)
          for (const s of members) {
            await dl.subscriptions.update(s.id, { groupId: gid })
            moved++
          }
        }
      } catch (e) {
        get().toast("error", "自动归组失败", e instanceof Error ? e.message : String(e))
      }
      set({ subscriptions: await dl.subscriptions.list(), groups: await dl.subscriptions.listGroups() })
      refreshView()
      if (!moved) return 0
      get().toast("ok", `已归类 ${moved} 条未分组订阅`, "按内容类型分组,可在设置里调整。", {
        label: "撤销",
        run: () => {
          void (async () => {
            // 撤销:全部移回未分组。分组本身留着(可能是用户本来就有的)。
            for (const b of before) await dl.subscriptions.update(b.id, { groupId: b.groupId })
            set({ subscriptions: await dl.subscriptions.list() })
            refreshView()
            get().toast("ok", "已撤销归组")
          })()
        },
      })
      return moved
    },

    setPaletteOpen(open) {
      set({ paletteOpen: open })
    },

    addToQueue(id) {
      // ⚠️ 社交条目没有可播流,进了队列后点它/「下一条」都会跳到解析失败的播放页。
      // 收口在入队处,比在每个队列行上加判断更彻底(详情弹窗也会调这里)。
      const item = get().allItems.find((i) => i.id === id)
      if (item?.kind === "social") {
        get().toast("warn", "社交内容不支持播放队列", "点开卡片可以看详情。")
        return
      }
      set((s) => (s.queue.includes(id) ? s : { queue: [...s.queue, id] }))
    },

    clearQueue() {
      set({ queue: [] })
    },

    toggleDanmaku() {
      set((s) => ({ danmakuVisible: !s.danmakuVisible }))
    },

    toast(tone, title, text, action) {
      const id = ++toastSeq
      set((s) => ({ toasts: [...s.toasts, { id, tone, title, text, ...(action ? { action } : {}) }] }))
      // 带动作的吐司给更长的阅读/点击时间(4.2s 来不及看清「撤销」就被收走)。
      setTimeout(() => get().dismissToast(id), action ? 8000 : 4200)
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

/**
 * 非 hook 版节点类型(在**动作回调**里用,如「打开文章」——回调不是渲染期,
 * 不能用 useNodeMeta)。语义与 useNodeMeta 一致。
 */
export function nodeTypeOf(nodeId: string | null): NodeType {
  const s = useDesktop.getState()
  return nodeMeta(nodeId, s.subscriptions, s.groups, (k) => s.dl?.channelKind(k)).type
}

/** 当前节点的分组成员订阅 id(分组聚合查询用)。 */
export function groupMemberIds(gid: string): string[] {
  return subscriptionIdsOfGroup(useDesktop.getState().subscriptions, gid)
}

export { nodeKindOf, usePrefs }
