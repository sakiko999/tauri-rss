/**
 * ListRow —— 文章列表行。未读点 + 标题/摘要/元信息 + 可选缩略图 + hover 操作区。
 *
 * 操作区常驻占位(只切 opacity)以避免行宽跳动。
 */
import type { MediaItem } from "@amoeba/core"
import { MediaImage } from "@amoeba/ui"

import { excerptOf, fmtAgo, itemKey, mediaUrl, ratioOf } from "../../lib/media.ts"
import { overlayBlock } from "../../lib/uiOverlay.ts"
import { Icon } from "../Icon.tsx"

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
  const excerpt = excerptOf(item)
  const read = !item.isUnread
  return (
    <div
      className="list-row"
      role="button"
      tabIndex={0}
      aria-current={active ? "true" : undefined}
      data-read={String(read)}
      {...overlayBlock("list-row", `list:${itemKey(item)}`)}
      onClick={() => onOpen(item)}
      onKeyDown={(e) => {
        // ⚠️ 行内还有星标/已读按钮:它们的 Enter/Space 会冒泡到这里,不区分 target 的话
        // 键盘用户在星标按钮上按回车会连带把文章打开。
        if (e.target !== e.currentTarget) return
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onOpen(item)
        }
      }}
    >
      <span className="unread-dot" data-read={String(read)} />
      <div className="list-body">
        <span className="list-title clamp-2">{item.title}</span>
        {/* 摘要单行:列表是「扫读」不是「阅读」,两行摘要会把行高顶到 90px+、
            一屏只看得到五六条,反而更难找东西。excerptOf 会滤掉「只剩链接复读」
            的噪声摘要。 */}
        {excerpt ? <span className="list-excerpt clamp-1">{excerpt}</span> : null}
        <span className="list-meta">
          {/* ⚠️ 不再用 `·` 连接:点分隔符是模板化设计的典型记号,满屏都是。
              改为「标签在最前、时间靠右」的分工 —— 元信息按自身语义分组,不靠符点。 */}
          {item.kind === "audio" || item.kind === "video" ? (
            <span className="list-kind">
              <Icon name={item.kind === "audio" ? "music" : "play"} size={11} />
            </span>
          ) : null}
          {item.author?.name ? <span className="list-author">{item.author.name}</span> : null}
          <span className="list-time">{fmtAgo(item.publishedAt)}</span>
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
