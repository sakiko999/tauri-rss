/**
 * ArticleList — 三栏中栏(文章列表,参考 tmp/rss-reader 的 article-list.tsx)。
 *
 * 数据来自 useDesktop.items(已按选中节点聚合),过滤 article kind。
 * 通常选中 tab:article(全局文章)时使用;smart feed 聚合下的文章不在此列。
 * 行:未读圆点 + 图标 + 标题/摘要/来源·时间。点击选中 → 右栏 ArticleDetail。
 */
import { Virtuoso } from "react-virtuoso"
import type { ArticleItem } from "@tauri-playground/core"
import { Rss } from "lucide-react"
import { cn } from "../lib/cn.ts"
import { useDesktop } from "../store.ts"

function fmtTime(ts?: number): string {
  if (!ts) return ""
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
  return d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })
}

function ArticleRow({
  item,
  selected,
  onClick,
}: {
  item: ArticleItem
  selected: boolean
  onClick: () => void
}) {
  return (
    <div
      className={cn(
        "flex gap-3 p-3 cursor-pointer border-b border-border/50",
        selected ? "bg-blue-600 text-white" : "hover:bg-muted/50",
      )}
      onClick={onClick}
    >
      {/* 未读圆点:isUnread !== false 视为未读(与 ArticleDetail 的 ?? true 一致)。
          selected 时隐藏圆点(选中态高亮已表达)。 */}
      <div className="flex items-start pt-2 shrink-0">
        {item.isUnread !== false && !selected && <div className="w-2 h-2 rounded-full bg-blue-500" />}
        {(item.isUnread === false || selected) && <div className="w-2 h-2" />}
      </div>

      {/* 图标 */}
      <div
        className={cn(
          "w-8 h-8 rounded-md flex items-center justify-center text-white font-semibold text-xs shrink-0",
          selected ? "bg-blue-700" : "bg-zinc-300",
        )}
      >
        <Rss className="h-4 w-4" />
      </div>

      {/* 内容 */}
      <div className="flex-1 min-w-0">
        <h3
          className={cn(
            "text-sm font-medium leading-snug line-clamp-2",
            selected ? "text-white" : "text-foreground",
          )}
        >
          {item.title}
        </h3>
        {item.summary && (
          <p className={cn("text-xs mt-0.5 line-clamp-1", selected ? "text-blue-100" : "text-muted-foreground")}>
            {item.summary}
          </p>
        )}
        <div className="flex items-center justify-between mt-1">
          <span className={cn("text-xs truncate", selected ? "text-blue-100" : "text-muted-foreground")}>
            {item.author?.name ?? item.url ?? "未知来源"}
          </span>
          <span className={cn("text-xs shrink-0 ml-2", selected ? "text-blue-100" : "text-muted-foreground")}>
            {fmtTime(item.publishedAt)}
          </span>
        </div>
      </div>
    </div>
  )
}

export function ArticleList() {
  const { items, selectedArticleId, selectArticle } = useDesktop()
  const articles = items.filter((it): it is ArticleItem => it.kind === "article")
  const unreadCount = articles.filter((a) => a.isUnread).length

  return (
    <div className="w-80 h-full bg-background border-r border-border flex flex-col shrink-0">
      {/* 头 */}
      <div className="h-12 flex items-center justify-between px-4 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">文章</span>
          <span className="text-xs text-muted-foreground">{unreadCount} 未读</span>
        </div>
      </div>

      {/* 列表:Virtuoso 虚拟化(文章是长列表,只渲染可见区) */}
      {articles.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">暂无文章</p>
      ) : (
        <Virtuoso
          className="flex-1"
          data={articles}
          itemContent={(_, a) => (
            <ArticleRow
              item={a}
              selected={a.id === selectedArticleId}
              onClick={() => selectArticle(a.id)}
            />
          )}
        />
      )}
    </div>
  )
}
