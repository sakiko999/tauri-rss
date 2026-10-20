/**
 * 视图/交互状态动作:节点切换、筛选/排序/分页窗口、热搜词、详情弹窗、feed 预览、
 * 分区目录预览。
 *
 * 从 store/index.ts 拆出;只依赖 StoreCtx。
 */
import type { AudioItem, CategoryItem } from "@amoeba/core"
import { PAGE_SIZE } from "../selectors.ts"
import { now } from "../lib.ts"
import type { DesktopState, StoreCtx } from "../types.ts"

/** 二级预览的复用窗口：进出切换不重复拉；过期后再点开会重抓。 */
const PREVIEW_TTL_MS = 60_000

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
  | "openPreviewDetail"
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

    /**
     * 打开二级订阅的内容（右侧主区，不再是弹窗）。
     *
     * 两类容器条目：
     *   - `kind:"category"` → 用自带的 `categoryChannel` + `categoryInfo`；
     *   - 播客 feed（`kind:"audio"` 且无 stream）→ `rss:podcast` + `{url}`。
     *
     * 结果临时存 `previewDetail`（不建订阅、不落库）。播放页回退查它才能找到
     * 预览里的单集（它们的 subscriptionId 是 `preview:<channel>`，不在 store 里）。
     */
    async openPreviewDetail(item, opts) {
      const dl = get().dl
      if (!dl) return
      let kind: "feed" | "category"
      let channelKey: string
      let info: Record<string, string>
      let invalid = ""
      if (item.kind === "category") {
        const category = item as CategoryItem
        kind = "category"
        channelKey = category.categoryChannel
        info = category.categoryInfo ?? {}
        if (!channelKey) invalid = "目录条目缺少目标渠道（categoryChannel 为空），无法预览。"
      } else if (item.kind === "audio" && !(item as AudioItem).stream) {
        kind = "feed"
        channelKey = "rss:podcast"
        info = { url: item.url ?? "" }
        if (!info.url) invalid = "这条没有 feed 地址（Apple 目录偶有缺 feedUrl 的条目）。"
      } else {
        return
      }

      // 请求键用「订阅 + 条目」：短时间内来回进出复用同一份结果，不重复拉。
      // ⚠️ 必须有 TTL:永久短路的话,同一个分区/节目本会话内再也不会重抓 ——
      // 10 点看到的房间列表 11 点还是它(全标 LIVE),空结果更是永远空。
      const key = `${item.subscriptionId}:${item.id}`
      const cur = get().previewDetail
      if (!opts?.force && cur?.key === key && now() - cur.at < PREVIEW_TTL_MS) return
      const base = {
        nodeId: item.subscriptionId,
        itemId: item.id,
        title: item.title,
        kind,
        channelKey,
        info,
        key,
        at: now(),
      }
      // ⚠️ 参数缺失也要落一条**错误态**的 previewDetail:直接 toast + return 的话,
      // MediaMain 把「previewDetail 为 null」当加载中,主区会永久停在骨架屏。
      if (invalid) {
        set({ previewDetail: { ...base, items: [], loading: false, error: invalid } })
        return
      }
      set({ previewDetail: { ...base, items: [], loading: true } })
      try {
        // ⚠️ 复用 `previewChannel` 的语义：不写缓存、不落 store、不建订阅。
        const { items } = await dl.previewChannel(channelKey, info)
        const cur = get().previewDetail
        if (cur?.key !== key) return
        set({ previewDetail: { ...cur, items, loading: false } })
      } catch (e) {
        const cur = get().previewDetail
        if (cur?.key !== key) return
        set({ previewDetail: { ...cur, loading: false, error: e instanceof Error ? e.message : String(e) } })
      }
    },
  }
}
