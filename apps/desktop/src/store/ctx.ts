import { now } from "./lib.ts"
import { isSmartFeed } from "./nodes.ts"
/**
 * createCtx —— 动作工厂共享的 set/get + 派生操作。
 *
 * 这些操作在多个动作文件里复用(refreshView 几乎每次 set 后都要调,
 * syncSubscriptions 被订阅 CRUD/刷新编排共用),放这里避免各写一份。
 */
import { queryView } from "./selectors.ts"
import type { StoreCtx, StoreGet, StoreSet } from "./types.ts"

export function createCtx(set: StoreSet, get: StoreGet): StoreCtx {
  /** items 内容版本：store 每次 emit（replace/append/patch/clear）自增。
   *  ⚠️ 不能拿 `store.all()` 的数组身份当键——它每次返回新数组。 */
  let itemsVersion = 0
  /** queryView 单槽记忆：刷新事件（WS 突发、busy/loading 翻转）常不改输入，
   *  合帧只能省掉重复调用，省不掉「同一输入再算一次」（全库 2.5k 条 = filter + sort）。 */
  let viewKey: readonly unknown[] | null = null
  let viewValue: ReturnType<typeof queryView> | null = null

  /** 合帧：同一微任务内的多次 refreshView 只算一次（markAllRead 的 N 次 patch、
   *  WS 事件突发都从这里收敛）。microtask 而非 rAF——WebView2 隐藏窗口 rAF 会停摆。 */
  let refreshScheduled = false
  function refreshView(): void {
    if (refreshScheduled) return
    refreshScheduled = true
    queueMicrotask(() => {
      refreshScheduled = false
      const s = get()
      if (!s.dl) return
      // 「今天」节点依赖时间，用日桶当键；其余节点与 now 无关。
      const node = s.selectedNodeId ?? "tab:all"
      const dayBucket = node === "today" ? Math.floor(now() / 86_400_000) : 0
      const key = [
        itemsVersion,
        s.subscriptions,
        node,
        s.filter[node],
        s.sort[node],
        s.page[node],
        s.query,
        dayBucket,
      ] as const
      if (viewValue && viewKey && key.every((v, i) => v === viewKey![i])) return
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
      const view = queryView(slice, s.selectedNodeId, now())
      viewKey = key
      viewValue = view
      set({ allItems: slice.allItems, view })
    })
  }

  /** store 变更（items 内容变了）→ 让下一次 refreshView 重算。 */
  function markItemsChanged(): void {
    itemsVersion++
  }

  /**
   * 订阅集变更后重读 + 重绘。
   *
   * ⚠️ **顺序不能倒**:`refreshView()` 从 `get().subscriptions` 取快照喂给
   * `queryView`,所以必须先 `set` 再 `refreshView` —— 反了会用旧列表算视图区间。
   *
   * ⚠️ 两个都读:分组 CRUD 会改 `groups`,而「删除分组」还会顺带把成员的 groupId
   * 置空(改 `subscriptions`),所以不能只读其中一个。
   */
  function syncSubscriptions(): Promise<void> {
    const dl = get().dl
    if (!dl) return Promise.resolve()
    return Promise.all([dl.subscriptions.list(), dl.subscriptions.listGroups()]).then(([subs, groups]) => {
      set({ subscriptions: subs, groups })
      refreshView()
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
    if (isSmartFeed(nodeId)) return false
    return !!get().subscriptions.find((s) => s.id === nodeId)
  }

  return { set, get, refreshView, markItemsChanged, syncSubscriptions, queryCanLoadMore, isRealSub }
}
