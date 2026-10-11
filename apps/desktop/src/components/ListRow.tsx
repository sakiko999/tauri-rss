/**
 * ListRow —— 文章列表行。未读点 + 标题/摘要/元信息 + 可选缩略图 + hover 操作区。
 *
 * 操作区常驻占位(只切 opacity)以避免行宽跳动。
 */
import type { MediaItem } from "@tauri-playground/core"
import { MediaImage } from "@tauri-playground/ui"
import { Icon } from "./Icon.tsx"
import { fmtAgo, mediaUrl, ratioOf } from "../lib/media.ts"

export function ListRow({
  item,
  active,
  onOpen,
  onToggleRead,
  onToggleStar,
}: {
  item: MediaItem
  active: boolean
  onOpen: (item: MediaItem) => void
  onToggleRead?: (item: MediaItem) => void
  onToggleStar?: (item: MediaItem) => void
}) {
  const thumb = mediaUrl(item)
  const read = !item.isUnread
  return (
    <div
      className="list-row"
      role="button"
      tabIndex={0}
      aria-current={active ? "true" : undefined}
      data-read={String(read)}
      onClick={() => onOpen(item)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onOpen(item)
        }
      }}
    >
      <span className="unread-dot" data-read={String(read)} />
      <div className="list-body">
        <span className="list-title clamp-2">{item.title}</span>
        {item.summary ? <span className="list-excerpt clamp-2">{item.summary}</span> : null}
        <span className="list-meta">
          {item.author?.name ? <span>{item.author.name}</span> : null}
          {item.author?.name ? <span className="dot-sep" /> : null}
          <span>{fmtAgo(item.publishedAt)}</span>
          {item.kind === "audio" || item.kind === "video" ? (
            <>
              <span className="dot-sep" />
              <Icon name={item.kind === "audio" ? "music" : "play"} size={11} />
            </>
          ) : null}
        </span>
      </div>
      {thumb ? (
        <span className="list-thumb">
          <MediaImage src={thumb} ratio={ratioOf(item)} />
        </span>
      ) : null}
      <span className="list-actions">
        {onToggleStar ? (
          <button
            className="icon-btn sm"
            aria-label={item.isStarred ? "取消星标" : "星标"}
            aria-pressed={!!item.isStarred}
            onClick={(e) => {
              e.stopPropagation()
              onToggleStar(item)
            }}
          >
            <Icon name="star" size={14} />
          </button>
        ) : null}
        {onToggleRead ? (
          <button
            className="icon-btn sm"
            aria-label={read ? "标为未读" : "标为已读"}
            onClick={(e) => {
              e.stopPropagation()
              onToggleRead(item)
            }}
          >
            <Icon name={read ? "eyeOff" : "eye"} size={14} />
          </button>
        ) : null}
      </span>
    </div>
  )
}
