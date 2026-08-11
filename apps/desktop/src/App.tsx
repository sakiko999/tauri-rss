/**
 * App — 三栏 RSS 阅读器(参考 tmp/rss-reader 的三栏布局)。
 *
 * 左栏 Sidebar(订阅/分组/smart feeds/tab),中栏按 kind 分发:
 *   - article → 文章列表(ArticleList) + 右栏详情(ArticleDetail),两栏;
 *   - video/audio/live/social → MediaItemView 卡片列表(MediaList),单栏。
 * showDetail 决策:**由视图内容 kind 驱动**(非选中节点类型)——当前视图 items
 *   全为 article 就进文章两栏。这自然覆盖 tab:article 全局文章 / 选中 article
 *   订阅源(如 HN) / smart feed 纯文章聚合。空视图(加载中/无数据)不进两栏。
 */
import { useEffect } from "react"
import { useDesktop } from "./store"
import { Sidebar } from "./components/Sidebar.tsx"
import { ArticleList } from "./components/ArticleList.tsx"
import { ArticleDetail } from "./components/ArticleDetail.tsx"
import { MediaList } from "./components/MediaList.tsx"

export default function App() {
  const { items, init } = useDesktop()

  useEffect(() => {
    init()
  }, [init])

  // 面板决策:文章详情三栏 vs 各 kind 卡片单栏。
  // 视图全为 article 才进文章两栏(选中 article 订阅源 / tab:article / 纯文章聚合)。
  // 空视图(items 加载中或无数据)显示卡片空态而非文章列表,避免加载完闪跳。
  const showDetail = items.length > 0 && items.every((it) => it.kind === "article")

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
