/**
 * AudioRenderer — 音频/播客条目卡片(横向紧凑行)。
 *
 * 方形封面缩略图 + 标题/艺术家·时长 + 内嵌 PlayableMedia(原生 <audio>)。
 * 播客 mp3 无签名,直链可直接播。样式走语义令牌。
 */
import { useMemo } from "react"
import type { AudioItem } from "@tauri-playground/core"
import type { RendererCallbacks } from "./types.ts"
import { PlayableMedia } from "@tauri-playground/player"
import { CardThumb } from "./atoms/CardThumb.tsx"
import { MediaCard } from "./atoms/MediaCard.tsx"
import { RelativeTime } from "./atoms/RelativeTime.tsx"
import { UnreadDot } from "./atoms/UnreadDot.tsx"
import { fmtAudioDuration } from "./atoms/format.ts"

export function AudioRenderer({
  item,
  onOpen,
  onToggleRead,
  onToggleStar,
}: { item: AudioItem } & RendererCallbacks) {
  const artist = item.artist ?? item.author?.name
  const duration = fmtAudioDuration(item.duration)
  const url = item.url
  // 稳定 streams 数组:item.stream 引用不变时数组复用,避免传导到 MediaPlayer.streams。
  const initialStreams = useMemo(() => (item.stream ? [item.stream] : undefined), [item.stream])
  return (
    <MediaCard onOpen={url ? () => onOpen?.(url) : undefined}>
      <div className="flex items-start gap-3 p-3">
        {/* 方形封面 */}
        <CardThumb
          src={item.thumbnail ?? item.poster}
          ratio="square"
          alt={item.title}
          className="size-20 shrink-0 rounded"
        />

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 items-start gap-1.5">
            <UnreadDot isUnread={item.isUnread ?? true} className="mt-1.5" />
            <h3 className="line-clamp-2 min-w-0 text-sm font-medium leading-snug">{item.title}</h3>
          </div>
          <div className="flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground">
            {artist && <span className="truncate">{artist}</span>}
            {duration && <span className="shrink-0">· {duration}</span>}
            {item.publishedAt && <RelativeTime ts={item.publishedAt} className="ml-auto shrink-0" />}
          </div>
          {/* 内嵌播放:有初始 stream 直接原生 <audio> */}
          <div className="mt-1 min-w-0" onClick={(e) => e.stopPropagation()}>
            <PlayableMedia streams={initialStreams} />
          </div>
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
      </div>
    </MediaCard>
  )
}
