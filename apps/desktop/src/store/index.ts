/**
 * useDesktop —— 全局 store 入口:初始状态 + 组合各领域动作。
 *
 * 分工:
 *   - **core(DataLayer)** 是数据权威:订阅/条目/阅读态/设置/缓存;
 *   - **本 store** 是「视图状态 + 动作编排」:选中节点、筛选、分页窗口、队列、
 *     播放页瞬时态、离线开关;
 *   - **URL(react-router)** 是「视图位置」权威:nodeId 来自 path,loader 里
 *     调 select() 同步,本 store 只做镜像(见 router.tsx)。
 *
 * 拆分(2026-10-18,原单文件 1115 行):
 *   types.ts          状态形状 + 动作契约 + StoreCtx
 *   lib.ts            队列持久化 / sameInfo / 超时 / 运行时设置 / 导航桥
 *   ctx.ts            refreshView / syncSubscriptions / queryCanLoadMore / isRealSub
 *   actions/data.ts   init / refresh / refreshAll / loadMore
 *   actions/view.ts   节点/筛选/热搜/详情/feed 预览
 *   actions/subs.ts   订阅/分组/设置/自动归组/OPML
 *   actions/reading.ts 已读/星标/续播/播放解析
 *   actions/ui.ts     离线/面板/队列/弹幕/toast
 * 本文件只保留初始状态、组合与「节点元信息」便捷函数。
 */
import { create } from "zustand"
import { nodeKindOf, nodeMeta, subscriptionIdsOfGroup, type NodeMeta, type NodeType } from "./nodes.ts"
import { usePrefs } from "./prefs.ts"
import { loadQueue } from "./lib.ts"
import { createCtx } from "./ctx.ts"
import { createDataActions } from "./actions/data.ts"
import { createViewActions } from "./actions/view.ts"
import { createSubsActions } from "./actions/subs.ts"
import { createReadingActions } from "./actions/reading.ts"
import { createUiActions } from "./actions/ui.ts"
import type { DesktopState } from "./types.ts"

export const useDesktop = create<DesktopState>()((set, get) => {
  const ctx = createCtx(set, get)
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
    ready: false,

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
    queue: loadQueue(),
    feedPreview: null,
    danmakuVisible: true,
    toasts: [],

    ...createDataActions(ctx),
    ...createViewActions(ctx),
    ...createSubsActions(ctx),
    ...createReadingActions(ctx),
    ...createUiActions(ctx),
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

export { setNavBridge } from "./lib.ts"
export type { Toast } from "./types.ts"
export { nodeKindOf, usePrefs }
