/**
 * createCtx —— 动作工厂共享的 set/get + 派生操作。
 *
 * 这些操作在多个动作文件里复用(refreshView 几乎每次 set 后都要调,
 * syncSubscriptions 被订阅 CRUD/刷新编排共用),放这里避免各写一份。
 */
import { queryView } from "./selectors.ts"
import { isSmartFeed } from "./nodes.ts"
import { now } from "./lib.ts"
import type { StoreCtx, StoreGet, StoreSet } from "./types.ts"

export function createCtx(set: StoreSet, get: StoreGet): StoreCtx {
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
    })
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

  return { set, get, refreshView, syncSubscriptions, queryCanLoadMore, isRealSub }
}
