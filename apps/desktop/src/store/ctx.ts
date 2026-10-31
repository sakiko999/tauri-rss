/**
 * createCtx —— 动作工厂共享的 set/get + 派生操作。
 *
 * 这些操作在多个动作文件里复用(refreshView 几乎每次 set 后都要调,
 * syncSubscriptions 被订阅 CRUD/刷新编排共用),放这里避免各写一份。
 */

import { now } from "./lib.ts"
import { isSmartFeed } from "./nodes.ts"
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
  /** 本帧是否要求「保留 allItems 身份」（progress 路径）。同帧内取或（结构化事件优先）。 */
  let keepItems = false
  function refreshView(opts?: { keepItems?: boolean }): void {
    keepItems = keepItems || opts?.keepItems === true
    if (refreshScheduled) return
    refreshScheduled = true
    queueMicrotask(() => {
      refreshScheduled = false
      const keep = keepItems
      keepItems = false
      const s = get()
      if (!s.dl) return
      // 「今天」节点依赖时间，用日桶当键；其余节点与 now 无关。
      const node = s.selectedNodeId ?? "tab:all"
      const dayBucket = node === "today" ? Math.floor(now() / 86_400_000) : 0
      const key = [
        itemsVersion,
        s.progressVersion,
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
      // progress 路径不换 allItems 身份：条目对象已被 media-store 原地更新，播放树
      // 无需重渲染（见 types.ts progressVersion）。
      if (keep) set({ view })
      else set({ allItems: slice.allItems, view })
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
   *
   * ⚠️ **自己修正 selectedNodeId**（2026-11-01）：退订/删分组后，选中节点可能已不存在。
   * 之前靠「8 处调用都必须先改再调」的约定，漏一处就是空视图。这里统一收口：
   * 选中项没了就回 `tab:all`，调用方只管改数据。
   */
  function syncSubscriptions(): Promise<void> {
    const dl = get().dl
    if (!dl) return Promise.resolve()
    return Promise.all([dl.subscriptions.list(), dl.subscriptions.listGroups()]).then(([subs, groups]) => {
      // 判「选中项被删了」要对**前后**两份快照比：只看新集合会把 tab/home/分区预览
      // 这类本来就不在订阅表里的节点误判成已删除。
      const prev = get()
      const node = prev.selectedNodeId
      const wasSub = !!node && prev.subscriptions.some((s) => s.id === node)
      const wasGroup = !!node && node.startsWith("group:") && prev.groups.some((g) => `group:${g.id}` === node)
      set({ subscriptions: subs, groups })
      const gone =
        (wasSub && !subs.some((s) => s.id === node)) || (wasGroup && !groups.some((g) => `group:${g.id}` === node))
      if (gone) set({ selectedNodeId: "tab:all" })
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
