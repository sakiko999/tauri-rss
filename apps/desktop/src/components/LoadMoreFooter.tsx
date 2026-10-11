/**
 * LoadMoreFooter —— 列表底部「加载更多」。
 *
 * 两种翻页来源,共用同一个尾部:
 *   1. **渠道分页**(仅真实订阅,`canLoadMore[id]`)→ `loadMore()` 让 DataLayer 翻页;
 *   2. **本地窗口**(聚合视图 tab:today/unread/starred/group 超过 PAGE_SIZE 条)
 *      → `growPage()` 放开本地切片窗口,不发网络请求。
 */
import { useEffect, useRef } from "react"
import { Icon } from "./Icon.tsx"
import { useDesktop } from "../store/index.ts"
import { isSmartFeed, isTabNode } from "../store/nodes.ts"

export function LoadMoreFooter() {
  const selectedNodeId = useDesktop((s) => s.selectedNodeId)
  const canLoadMore = useDesktop((s) => s.canLoadMore)
  const loadMoreEnded = useDesktop((s) => s.loadMoreEnded)
  const loadingMore = useDesktop((s) => s.loadingMore)
  const loadMore = useDesktop((s) => s.loadMore)
  const view = useDesktop((s) => s.view)
  const growPage = useDesktop((s) => s.growPage)
  const nodeId = selectedNodeId ?? ""
  const loadingRef = useRef(loadingMore)
  loadingRef.current = loadingMore

  // 真实订阅的渠道分页。
  const channelPaging = !!nodeId && !isSmartFeed(nodeId) && !isTabNode(nodeId) && !!canLoadMore[nodeId]
  const ended = !!loadMoreEnded[nodeId]
  // 本地窗口分页(渠道分页以渠道为准,不叠加)。
  const localPaging = !channelPaging && view.hasMore
  const visible = channelPaging || localPaging
  const ref = useRef<HTMLDivElement>(null)

  const trigger = () => {
    if (channelPaging) {
      if (!loadingRef.current && !ended) void loadMore()
    } else if (localPaging) {
      growPage(nodeId)
    }
  }

  // 触底自动加载(提前 200px)。渠道分页到底后停;本地窗口同步展开。
  useEffect(() => {
    const el = ref.current
    if (!el || !visible || (channelPaging && ended)) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) trigger()
      },
      { rootMargin: "200px 0px" },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [visible, ended, channelPaging, localPaging, nodeId])

  if (!visible) return null
  return (
    <div ref={ref} className="load-more">
      {channelPaging && ended ? (
        <span className="t-micro t-dim">已加载全部</span>
      ) : channelPaging && loadingMore ? (
        <Icon name="loader" size={16} className="animate-spin t-dim" />
      ) : (
        <button className="btn btn-secondary btn-sm" onClick={trigger}>
          加载更多
        </button>
      )}
    </div>
  )
}
