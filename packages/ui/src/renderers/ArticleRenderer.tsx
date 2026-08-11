/**
 * ArticleRenderer — 文章条目标题/摘要/作者/时间 + 图片附件缩略图。
 * 列表行式(紧凑),移动端/其他宿主也可复用。样式走语义令牌。
 */
import type { ArticleItem } from "@tauri-playground/core"
import type { RendererCallbacks } from "./types.ts"
import { CardThumb } from "./atoms/CardThumb.tsx"
import { MediaCard } from "./atoms/MediaCard.tsx"
import { RelativeTime } from "./atoms/RelativeTime.tsx"
import { UnreadDot } from "./atoms/UnreadDot.tsx"

export function ArticleRenderer({
  item,
  onOpen,
  onToggleRead,
  onToggleStar,
}: { item: ArticleItem } & RendererCallbacks) {
  const img = item.media?.find((m) => m.kind === "image")
  const url = item.url
  return (
    <MediaCard onOpen={url ? () => onOpen?.(url) : undefined}>
      <div className="flex items-start gap-3 p-3">
        {/* 未读圆点列 */}
        <div className="flex h-full items-start pt-1.5">
          <UnreadDot isUnread={item.isUnread ?? true} />
        </div>

        {/* 附件图 */}
        {img && (
          <CardThumb src={img.url} ratio="square" alt="" className="size-16 shrink-0 rounded" />
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="line-clamp-2 text-sm font-medium leading-snug">{item.title}</h3>
          {/* summary 是 HTML(HN 等链接聚合源的元信息 / 文章正文摘要),按 HTML 渲染使链接可点 */}
          {item.summary && (
            <p
              className="line-clamp-2 text-xs leading-relaxed text-muted-foreground"
              dangerouslySetInnerHTML={{ __html: item.summary }}
            />
          )}
          <div className="flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground">
            {item.author?.name && <span className="truncate">{item.author.name}</span>}
            {item.publishedAt && (
              <>
                <span className="shrink-0">·</span>
                <RelativeTime ts={item.publishedAt} className="shrink-0" />
              </>
            )}
            <div className="ml-auto flex shrink-0 items-center gap-1">
              {onToggleRead && (
                <button
                  className="rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground"
                  onClick={(e) => { e.stopPropagation(); onToggleRead!(item) }}
                  title={(item.isUnread ?? true) ? "标已读" : "标未读"}
                >
                  {(item.isUnread ?? true) ? "已读" : "未读"}
                </button>
              )}
              {onToggleStar && (
                <button
                  className="rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground"
                  onClick={(e) => { e.stopPropagation(); onToggleStar!(item) }}
                  title={item.isStarred ? "取消星标" : "加星标"}
                >
                  {item.isStarred ? "★" : "☆"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </MediaCard>
  )
}
