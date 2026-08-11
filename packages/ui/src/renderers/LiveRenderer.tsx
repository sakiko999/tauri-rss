/**
 * LiveRenderer — 直播房间卡片(网格纵向大图,参考 Folo video-item 形态)。
 *
 * 16:9 图在上 + 直播状态角标(live 红底「●直播中」/ offline 灰边)+
 * 标题/平台·在线 + 底栏(大屏播放 | 内嵌播放 + 星标)。
 * playUrls 懒解析(带 expiry 签名):点击播放经 onResolveLivePlay 拿流。
 */
import type { LiveItem } from "@tauri-playground/core"
import type { RendererCallbacks } from "./types.ts"
import { PlayableMedia } from "@tauri-playground/player"
import { CardThumb } from "./atoms/CardThumb.tsx"
import { MediaCard } from "./atoms/MediaCard.tsx"
import { RelativeTime } from "./atoms/RelativeTime.tsx"
import { UnreadDot } from "./atoms/UnreadDot.tsx"
import { fmtCount } from "./atoms/format.ts"

const STATUS_LABEL: Record<LiveItem["liveStatus"], string> = {
  live: "● 直播中",
  offline: "已停播",
  unknown: "未知",
}

export function LiveRenderer({
  item,
  onOpen,
  onToggleRead,
  onToggleStar,
  onResolveLivePlay,
  onPlayBig,
}: { item: LiveItem } & RendererCallbacks) {
  const isLive = item.liveStatus === "live"
  const url = item.url
  const statusBadge = isLive ? (
    <span className="rounded bg-live px-1.5 py-0.5 text-xs font-medium text-white">
      {STATUS_LABEL[item.liveStatus]}
    </span>
  ) : (
    <span className="rounded border border-border bg-card/80 px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
      {STATUS_LABEL[item.liveStatus]}
    </span>
  )

  return (
    <MediaCard onOpen={url ? () => onOpen?.(url) : undefined} className="h-full">
      {/* 16:9 图 + 状态角标(左上) */}
      <CardThumb
        src={item.thumbnail ?? item.poster}
        ratio="video"
        alt={item.title || item.roomId}
        badge={statusBadge}
        badgeClassName="left-2 top-2"
      />

      {/* 标题 + 平台·在线 */}
      <div className="flex min-w-0 flex-col gap-1 px-3 py-2.5">
        <div className="flex min-w-0 items-start gap-1.5">
          <UnreadDot isUnread={item.isUnread ?? true} className="mt-1.5" />
          <h3 className="line-clamp-2 min-w-0 text-sm font-medium leading-snug">{item.title || item.roomId}</h3>
        </div>
        <div className="flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground">
          <span>{item.platform}</span>
          <span className="shrink-0">·</span>
          <span className="shrink-0">房间 {item.roomId}</span>
          {item.online !== undefined && (
            <>
              <span className="shrink-0">·</span>
              <span className="shrink-0">{fmtCount(item.online)} 在线</span>
            </>
          )}
          {item.publishedAt && <RelativeTime ts={item.publishedAt} className="ml-auto shrink-0" />}
        </div>
        {item.introduction && <p className="line-clamp-1 text-xs text-muted-foreground">{item.introduction}</p>}
      </div>

      {/* 底栏:播放入口 + 星标 */}
      <div className="mt-auto flex items-center justify-between gap-2 px-3 pb-3">
        {onPlayBig ? (
          <button
            className="rounded bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
            onClick={(e) => {
              e.stopPropagation()
              onPlayBig()
            }}
          >
            ▶ 大屏播放
          </button>
        ) : (
          <div className="min-w-0 flex-1" onClick={(e) => e.stopPropagation()}>
            <PlayableMedia resolve={onResolveLivePlay ? () => onResolveLivePlay!(item.roomId) : undefined} />
          </div>
        )}
        <div className="flex shrink-0 items-center gap-1">
          {onToggleRead && (
            <button
              className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={(e) => { e.stopPropagation(); onToggleRead!(item) }}
              title={(item.isUnread ?? true) ? "标已读" : "标未读"}
            >
              {(item.isUnread ?? true) ? "已读" : "未读"}
            </button>
          )}
          {onToggleStar && (
            <button
              className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={(e) => { e.stopPropagation(); onToggleStar!(item) }}
              title={item.isStarred ? "取消星标" : "加星标"}
            >
              {item.isStarred ? "★" : "☆"}
            </button>
          )}
        </div>
      </div>
    </MediaCard>
  )
}
