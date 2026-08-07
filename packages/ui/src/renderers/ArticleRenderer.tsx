/**
 * ArticleRenderer — 文章条目标题/摘要/作者/时间 + 图片附件缩略图。
 * 样式走 Tailwind 4 类。
 */
import type { ArticleItem } from "@tauri-playground/core"
import type { RendererCallbacks } from "./types.ts"

export function ArticleRenderer({
  item,
  onOpen,
  onToggleRead,
  onToggleStar,
}: { item: ArticleItem } & RendererCallbacks) {
  const img = item.media?.find((m) => m.kind === "image")
  return (
    <article
      className="mb-2 cursor-pointer rounded-lg border border-zinc-200 p-3 hover:bg-zinc-50"
      onClick={() => item.url && onOpen?.(item.url)}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="m-0 text-base font-medium">{item.title}</h3>
        <span className="shrink-0 rounded border border-zinc-300 px-1.5 text-xs text-zinc-500">article</span>
      </div>
      {img && (
        <img
          src={img.url}
          alt=""
          className="mt-2 max-h-20 max-w-[120px] rounded object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      )}
      {/* summary 是 HTML(HN 等链接聚合源的元信息 / 文章正文摘要),按 HTML 渲染使链接可点 */}
      {item.summary && (
        <p className="mt-2 text-sm text-zinc-600" dangerouslySetInnerHTML={{ __html: item.summary }} />
      )}
      <div className="mt-2 flex items-center gap-3 text-xs text-zinc-500">
        {item.author?.name && <span>{item.author.name}</span>}
        {item.publishedAt && <span>{new Date(item.publishedAt).toLocaleString()}</span>}
        <button
          className="rounded border border-zinc-300 px-2 py-0.5 text-sm hover:bg-zinc-100"
          onClick={(e) => { e.stopPropagation(); onToggleRead?.(item) }}
        >
          {(item.isUnread ?? true) ? "标已读" : "标未读"}
        </button>
        <button
          className="rounded border border-zinc-300 px-2 py-0.5 text-sm hover:bg-zinc-100"
          onClick={(e) => { e.stopPropagation(); onToggleStar?.(item) }}
        >
          {item.isStarred ? "★" : "☆"}
        </button>
      </div>
    </article>
  )
}
