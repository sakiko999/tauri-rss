/**
 * LoadMoreFooter — 订阅「加载更多」:触底自动翻页(IO 提前 200px 预载) + 按钮手动兜底。
 *
 * **独立组件**(自己订阅 useDesktop,与 VirtuosoGrid 无关)——VirtuosoGrid(非 social
 * 网格)与 MasonryGrid(social 瀑布流)的底部共用。分页只对**真实订阅节点**生效
 * (canLoadMore 查询为 true 时),tab / smart feed 不显示。
 *
 * ⚠️ 曾内联在 MediaList(作 VirtuosoGrid 的 components.Footer)——MasonryGrid 分支
 * 没有 Footer,weibo:user(social 独占)滚到底不翻页。抽出后两处共用,单订阅 social
 * 瀑布流也能滚到自动加载更多。
 */
import { useEffect, useRef } from "react"
import { Loader2 } from "lucide-react"
import { isSmartFeed, isTabNode, useDesktop } from "../store.ts"

export function LoadMoreFooter() {
  const selectedNodeId = useDesktop((s) => s.selectedNodeId)
  const canLoadMore = useDesktop((s) => s.canLoadMore)
  const loadMoreEnded = useDesktop((s) => s.loadMoreEnded)
  const loadingMore = useDesktop((s) => s.loadingMore)
  const loadMore = useDesktop((s) => s.loadMore)
  const nodeId = selectedNodeId ?? ""
  const visible = !!nodeId && !isSmartFeed(nodeId) && !isTabNode(nodeId) && !!canLoadMore[nodeId]
  const ended = !!loadMoreEnded[nodeId]
  const ref = useRef<HTMLDivElement>(null)
  const loadingRef = useRef(loadingMore)
  loadingRef.current = loadingMore

  // 触底自动加载:Footer 进入视口即翻页(提前 200px,滚动近底预载,不中断)。
  // ⚠️ IO root 用默认 viewport:MasonryGrid 的滚动容器是内层 div(同其底部哨兵),
  // 但 footer 进入视口即可触发,不依赖外层滚动;VirtuosoGrid 同理。
  // IO 只挂一次(依赖 visible/ended/loadMore);loading 用 ref 防重入,避免 IO 重建。
  useEffect(() => {
    const el = ref.current
    if (!el || !visible || ended) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loadingRef.current) loadMore()
      },
      { rootMargin: "200px 0px" },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [visible, ended, loadMore])

  return (
    <div ref={ref} className="flex justify-center py-4">
      {visible ? (
        loadingMore ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : ended ? (
          <span className="text-xs text-muted-foreground">已加载全部</span>
        ) : (
          <button
            onClick={loadMore}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            加载更多
          </button>
        )
      ) : null}
    </div>
  )
}