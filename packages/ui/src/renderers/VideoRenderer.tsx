/**
 * VideoRenderer — 视频条目卡片(紧凑小卡片,网格布局用)。
 *
 * video 源是**长列表**(很多项)——用紧凑横向小卡片:小缩略图(16:9 约 112px 宽)
 * + 标题/频道·时间 + 播放入口,让网格单屏塞下更多条目。
 * (对比 live 是 1:1 订阅单项 → 用 16:9 大图卡,见 LiveRenderer。)
 *
 * 不内嵌小播放器——desktop 宿主提供 onPlayBig → 模态大播放器;无 onPlayBig 时
 * 回退内嵌 PlayableMedia(兼容 mobile/未接线的宿主)。样式走语义令牌。
 */
import { useMemo } from "react"
import type { VideoItem } from "@tauri-playground/core"
import type { RendererCallbacks } from "./types.ts"
import { PlayableMedia } from "@tauri-playground/player"
import { CardThumb } from "./atoms/CardThumb.tsx"
import { MediaCard } from "./atoms/MediaCard.tsx"
import { RelativeTime } from "./atoms/RelativeTime.tsx"
import { UnreadDot } from "./atoms/UnreadDot.tsx"
import { fmtDuration } from "./atoms/format.ts"

export function VideoRenderer({
  item,
  onOpen,
  onToggleRead,
  onToggleStar,
  onResolvePlay,
  onPlayBig,
}: { item: VideoItem } & RendererCallbacks) {
  const url = item.url
  const duration = fmtDuration(item.duration)
  // 稳定 streams 数组:item.stream 引用不变时数组也复用同引用,避免传导到
  // useStreamSelection → setActiveStream(null) 空跑 / useMediaStream 重跑。
  const initialStreams = useMemo(() => (item.stream ? [item.stream] : undefined), [item.stream])
  return (
    <MediaCard onOpen={url ? () => onOpen?.(url) : undefined} className="h-full">
      <div className="flex items-start gap-2.5 p-2.5">
        {/* 小缩略图:16:9 约 112px 宽(紧凑卡核心——省垂直空间,列表塞更多) */}
        <CardThumb
          src={item.poster ?? item.thumbnail}
          ratio="video"
          alt={item.title}
          className="w-28 shrink-0 rounded"
          badge={duration ? <span className="rounded bg-black/70 px-1 py-0.5 text-[10px] font-medium text-white">{duration}</span> : undefined}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 items-start gap-1.5">
            <UnreadDot isUnread={item.isUnread ?? true} className="mt-1" />
            <h3 className="line-clamp-2 min-w-0 text-sm font-medium leading-snug">{item.title}</h3>
          </div>
          <div className="flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground">
            {item.channel?.name && <span className="truncate">{item.channel.name}</span>}
            <span className="shrink-0">·</span>
            <RelativeTime ts={item.publishedAt} className="shrink-0" />
          </div>

          {/* 底栏:播放入口 + 星标 */}
          <div className="mt-auto flex items-center gap-1">
            {onPlayBig ? (
              <button
                className="rounded bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                onClick={(e) => {
                  e.stopPropagation()
                  onPlayBig()
                }}
              >
                ▶ 大屏播放
              </button>
            ) : (
              <div className="min-w-0 flex-1" onClick={(e) => e.stopPropagation()}>
                <PlayableMedia
                  streams={initialStreams}
                  resolve={onResolvePlay ? () => onResolvePlay!(item.id) : undefined}
                />
              </div>
            )}
            <div className="ml-auto flex shrink-0 items-center gap-0.5">
              {onToggleRead && (
                <button
                  className="rounded px-1 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={(e) => { e.stopPropagation(); onToggleRead!(item) }}
                  title={(item.isUnread ?? true) ? "标已读" : "标未读"}
                >
                  {(item.isUnread ?? true) ? "已读" : "未读"}
                </button>
              )}
              {onToggleStar && (
                <button
                  className="rounded px-1 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
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
