/**
 * App — 三栏 RSS 阅读器(参考 tmp/rss-reader 的三栏布局)。
 *
 * 左栏 Sidebar(订阅/分组/smart feeds/tab),中栏按 kind 分发:
 *   - article → 文章列表(ArticleList) + 右栏详情(ArticleDetail),两栏;
 *   - video/audio/live/social → MediaItemView 卡片列表(MediaList),单栏。
 * showDetail 决策:activeTab 显式选 article 或(all 且当前视图以文章为主)。
 */
import { useEffect } from "react"
import { useDesktop } from "./store"
import { Sidebar } from "./components/Sidebar.tsx"
import { ArticleList } from "./components/ArticleList.tsx"
import { ArticleDetail } from "./components/ArticleDetail.tsx"
import { MediaList } from "./components/MediaList.tsx"

export default function App() {
  const { activeTab, init } = useDesktop()

  useEffect(() => {
    init()
  }, [init])

  // 面板决策:文章详情三栏 vs 各 kind 卡片单栏。
  // 只有显式选 article tab 才进文章两栏;默认(all)始终显示全部内容卡片页,
  // 不因「存在文章」自动切走(否则刷新后数据加载完会跳到 HN 文章页)。
  const showDetail = activeTab === "article"

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
