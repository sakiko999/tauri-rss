/**
 * App — 三栏 RSS 阅读器(参考 tmp/rss-reader 的三栏布局)。
 *
 * 布局形态**由 URL 节点意图驱动**(非内容猜测),纯函数式分发:
 *   - 第一步 cond(节点状态 → 类型标签):weibo:hot 订阅 → "hot";article 类节点
 *     → "article";其余(聚合视图 / 非 article 订阅)→ "media";
 *   - 第二步 cond(类型标签 → 视图组件):策略表分发到独立视图组件。
 *
 * URL 是「视图位置」唯一真相(nodeId 来自 path),store 只是数据镜像
 * (selectedNodeId 由 router loader 同步)。聚合视图无论内容是否全是 article
 * 都走 MediaList——「今日」不该被吞进文章三栏;加载中/空内容也不闪跳布局。
 */
import { useEffect } from "react"
import { useParams } from "react-router"
import { always, cond, equals, T } from "ramda"
import type { MediaItem } from "@tauri-playground/core"
import { nodeKindOf, useDesktop } from "./store"
import { Sidebar } from "./components/Sidebar.tsx"
import { ArticleList } from "./components/ArticleList.tsx"
import { ArticleDetail } from "./components/ArticleDetail.tsx"
import { MediaList } from "./components/MediaList.tsx"
import { HotWordList } from "./components/HotWordList.tsx"

/** 视图形态标签(cond 分发的输入/输出)。 */
type ViewKind = "hot" | "article" | "media"

export default function App() {
  // URL 是「视图位置」权威:nodeId 来自 path,热搜词来自 search。
  const { nodeId } = useParams()
  const { subscriptions, hotWord, init } = useDesktop()

  useEffect(() => {
    init()
  }, [init])

  // 节点意图:真实订阅(裸 id)→ 查订阅配置(查不到即非订阅节点)。
  const sub = nodeId ? subscriptions.find((s) => s.id === nodeId) : undefined
  // 节点固有 kind 由 store 统一给出(tab / smart feed / 订阅三分支)。
  const kind = nodeKindOf(nodeId ?? null, subscriptions)

  // 1. 节点状态 → 类型标签(cond 策略表,无布尔中间量):weibo:hot → hot;article → article。
  const viewKind = cond<[string | undefined, string | undefined], ViewKind>([
    [(key) => key === "weibo:hot", always("hot")],
    [(_, kind) => kind === "article", always("article")],
    [T, always("media")],
  ])(sub?.channelKey, kind)

  // 2. 类型标签 → 视图组件(策略表分发)。
  const view = cond<[ViewKind], React.ReactNode>([
    [equals<ViewKind>("hot"), always(<HotView hotWord={hotWord} />)],
    [equals<ViewKind>("article"), always(<ArticleView />)],
    [T, always(<MediaView />)],
  ])(viewKind)

  return (
    <div className="flex h-screen bg-background font-sans overflow-hidden">
      <Sidebar />
      {view}
    </div>
  )
}

/** 热搜三栏:中栏热搜词条 + 右栏该词 social 流。 */
function HotView({ hotWord }: { hotWord: { word: string; items: MediaItem[] } | null }) {
  return (
    <>
      <HotWordList />
      <MediaList itemsOverride={hotWord?.items} />
    </>
  )
}

/** 文章三栏:中栏文章列表 + 右栏详情。 */
function ArticleView() {
  return (
    <>
      <ArticleList />
      <ArticleDetail />
    </>
  )
}

/** 卡片单栏(聚合视图 / 非 article 订阅)。 */
function MediaView() {
  return <MediaList />
}
