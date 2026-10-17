/**
 * 视图/交互状态动作:节点切换、筛选/排序/分页窗口、热搜词、详情弹窗、feed 预览。
 *
 * 从 store/index.ts 拆出;只依赖 StoreCtx。
 */
import { PAGE_SIZE } from "../selectors.ts"
import type { DesktopState, StoreCtx } from "../types.ts"

type ViewActions = Pick<
  DesktopState,
  | "select"
  | "loadHotWord"
  | "setQuery"
  | "setFilter"
  | "setSort"
  | "growPage"
  | "toggleGroup"
  | "selectArticle"
  | "openSocialDetail"
  | "closeSocialDetail"
  | "openFeedPreview"
  | "closeFeedPreview"
>

export function createViewActions(ctx: StoreCtx): ViewActions {
  const { set, get, refreshView, queryCanLoadMore, isRealSub } = ctx

  return {
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
        .resolveDetail(item.subscriptionId, item.id)
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

    async openFeedPreview(item) {
      const dl = get().dl
      if (!dl) return
      const feedUrl = item.url ?? ""
      if (!feedUrl) {
        get().toast("error", "这条没有 feed 地址", "Apple 目录偶有缺 feedUrl 的条目,已在上游过滤。")
        return
      }
      // 先占位(空列表 + 标题),让弹窗立刻出现骨架,不要点下去像没反应。
      set({ feedPreview: { title: item.title, feedUrl, items: [] } })
      try {
        // ⚠️ 复用 `rss:podcast` 渠道取单集 —— 它就是「feed URL → Audio 条目」,
        // 与订阅后走的是同一段解析,不另造。`previewChannel` 不写缓存、不落 store。
        const { items } = await dl.previewChannel("rss:podcast", { url: feedUrl })
        // 用户在等待期间可能已经关了弹窗/换了一条 —— 过期结果不覆盖(用 feedUrl 判).
        if (get().feedPreview?.feedUrl !== feedUrl) return
        set({ feedPreview: { title: item.title, feedUrl, items } })
      } catch (e) {
        if (get().feedPreview?.feedUrl !== feedUrl) return
        get().toast("error", "读不到该节目的单集", e instanceof Error ? e.message : String(e))
        set({ feedPreview: null })
      }
    },

    closeFeedPreview() {
      set({ feedPreview: null })
    },
  }
}
