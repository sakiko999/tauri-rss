/**
 * App — 三栏 RSS 阅读器(参考 tmp/rss-reader 的三栏布局)。
 *
 * 左栏 Sidebar(订阅/分组/smart feeds/tab),中栏按 kind 分发:
 *   - article → 文章列表(ArticleList) + 右栏详情(ArticleDetail),两栏;
 *   - video/audio/live/social → MediaItemView 卡片列表(MediaList),单栏。
 * showDetail 决策:**由选中节点类型驱动**(非内容猜测)——只有「明确的文章视图」
 *   才进文章两栏:选中 tab:article 或真实文章类订阅源(如 HN)。聚合视图
 *   (tab:all / 非 article 的 tab / smart feeds:today·unread·starred)**无论内容
 *   是否恰好全为 article 都走中栏 MediaList**——「今日」聚合不该被吞进文章三栏。
 *   空视图(items 加载中或无数据)不进两栏。
 */
import { useEffect } from "react"
import { isSmartFeed, isTabNode, useDesktop } from "./store"
import { Sidebar } from "./components/Sidebar.tsx"
import { ArticleList } from "./components/ArticleList.tsx"
import { ArticleDetail } from "./components/ArticleDetail.tsx"
import { MediaList } from "./components/MediaList.tsx"

export default function App() {
  const { items, selectedNodeId, init } = useDesktop()

  useEffect(() => {
    init()
  }, [init])

  // 面板决策:文章详情三栏 vs 各 kind 卡片单栏。
  // 文章视图 = 选中 tab:article 或真实订阅源(聚合视图 tab:all/today 等不进三栏,
  // 即使用户恰好看到的内容全是 article)。
  // 空视图(items 加载中或无数据)显示卡片空态而非文章列表,避免加载完闪跳。
  const selectedIsSub = !!selectedNodeId && !isSmartFeed(selectedNodeId) && !isTabNode(selectedNodeId)
  const showDetail =
    items.length > 0 &&
    items.every((it) => it.kind === "article") &&
    (selectedNodeId === "tab:article" || selectedIsSub)

  return (
    <div className="flex h-screen bg-background font-sans overflow-hidden">
      <Sidebar />
      {showDetail ? (
        <>
          <ArticleList />
          <ArticleDetail />
        </>
      ) : (
        <MediaList />
      )}
    </div>
  )
}
