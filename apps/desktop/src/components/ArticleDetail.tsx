/**
 * ArticleDetail — 三栏右栏(文章详情,参考 tmp/rss-reader 的 article-detail.tsx)。
 *
 * 从 useDesktop.items 找选中 article,渲染正文:
 *   - contentFormat === "html" → dangerouslySetInnerHTML(与 ui 包 ArticleRenderer 对 summary 的做法一致);
 *   - 其余 → <pre> 纯文本展示。
 * 工具栏:已读/星标切换 + 打开原文链接。
 */
import type { ArticleItem } from "@tauri-playground/core"
import { Circle, Star, ExternalLink } from "lucide-react"
import { cn } from "../lib/cn.ts"
import { useDesktop } from "../store.ts"

export function ArticleDetail() {
  const { items, selectedArticleId, markRead, toggleStar } = useDesktop()
  const article = items.find(
    (it): it is ArticleItem => it.kind === "article" && it.id === selectedArticleId,
  )

  if (!article) {
    return (
      <div className="flex-1 h-full bg-background flex items-center justify-center text-muted-foreground">
        选择一篇文章查看详情
      </div>
    )
  }

  const isHtml = article.contentFormat === "html" || (!article.contentFormat && article.content?.trimStart().startsWith("<"))
  const isUnread = article.isUnread ?? true
  const isStarred = article.isStarred ?? false

  return (
    <div className="flex-1 h-full bg-background flex flex-col min-w-0">
      {/* 工具栏 */}
      <div className="h-12 flex items-center justify-between px-4 border-b border-border shrink-0">
        <div className="flex items-center gap-1">
          <button
            className="p-2 hover:bg-muted rounded"
            title={isUnread ? "标已读" : "标未读"}
            onClick={() => markRead(article)}
          >
            <Circle
              className={cn("h-4 w-4", isUnread ? "fill-blue-500 text-blue-500" : "text-muted-foreground")}
            />
          </button>
          <button
            className="p-2 hover:bg-muted rounded"
            title={isStarred ? "取消星标" : "加星标"}
            onClick={() => toggleStar(article)}
          >
            <Star
              className={cn("h-4 w-4", isStarred ? "fill-yellow-500 text-yellow-500" : "text-muted-foreground")}
            />
          </button>
          {article.url && (
            <button className="p-2 hover:bg-muted rounded" title="打开原文" onClick={() => window.open(article.url, "_blank")}>
              <ExternalLink className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>

      {/* 正文 */}
      <div className="flex-1 overflow-y-auto">
        <article className="max-w-3xl mx-auto px-8 py-6">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{article.author?.name ?? article.url ?? "未知来源"}</span>
            <span className="text-sm text-muted-foreground">{article.publishedAt ? new Date(article.publishedAt).toDateString() : ""}</span>
          </div>
          <h1 className="text-2xl font-bold text-balance">{article.title}</h1>

          {article.summary && (
            <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{article.summary}</p>
          )}

          <div className="mt-4 border-t border-border pt-4">
            {isHtml ? (
              <div
                className="prose prose-sm max-w-none prose-zinc dark:prose-invert"
                dangerouslySetInnerHTML={{ __html: article.content ?? "" }}
              />
            ) : (
              <pre className="whitespace-pre-wrap text-sm leading-relaxed">{article.content}</pre>
            )}
          </div>
        </article>
      </div>
    </div>
  )
}
