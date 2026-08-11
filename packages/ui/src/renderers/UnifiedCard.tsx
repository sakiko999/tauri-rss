/**
 * UnifiedCard — 混合视图(如 tab:all)的统一卡片。
 *
 * 背景:VirtuosoGrid 要求**等尺寸 item**(虚拟化前提),而不同 kind 的专属卡
 * (video 紧凑小卡 / live 大图 / social 变高瀑布流)高度差异大,混排会重排错位。
 * 因此混合视图不再用 kind 专属卡,改用本统一卡:同一壳 + kind 徽标区分。
 * 单一 kind 视图(如 tab:live / tab:social)仍走各自专属布局。
 *
 * 结构:16:9 缩略图(kind 徽标角标 + video 时长角标) + 标题 + 元信息行
 *   (kind 标签 + 核心字段) + 底栏(播放入口 + 未读/星标)。样式走语义令牌。
 */
import { useMemo } from "react"
import type { MediaItem } from "@tauri-playground/core"
import { PlayableMedia } from "@tauri-playground/player"
import type { RendererCallbacks } from "./types.ts"
import { CardThumb } from "./atoms/CardThumb.tsx"
import { MediaCard } from "./atoms/MediaCard.tsx"
import { RelativeTime } from "./atoms/RelativeTime.tsx"
import { UnreadDot } from "./atoms/UnreadDot.tsx"
import { fmtAudioDuration, fmtCount, fmtDuration } from "./atoms/format.ts"

/** kind → 徽标文本。 */
const KIND_BADGE: Record<MediaItem["kind"], string> = {
  article: "文章",
  video: "视频",
  audio: "音频",
  live: "直播",
  social: "社交",
}

/** 统一缩略图源:各 kind 封面字段归一到 thumbnail ?? poster。 */
function thumbSrc(item: MediaItem): string | undefined {
  return item.thumbnail ?? item.poster
}

/** 元信息行:kind 专属的核心字段(标题下第一行)。 */
function metaLine(item: MediaItem): string {
  switch (item.kind) {
    case "live":
      // 平台;直播中且有在线数 → 平台 · 在线。
      return item.liveStatus === "live" && item.online !== undefined
        ? `${item.platform} · ${fmtCount(item.online)} 在线`
        : item.platform
    case "video":
      return item.channel?.name ?? item.author?.name ?? ""
    case "audio":
      return item.artist ?? item.author?.name ?? ""
    case "social":
    case "article":
      return item.author?.name ?? ""
  }
}

export function UnifiedCard({ item, ...callbacks }: { item: MediaItem } & RendererCallbacks) {
  const url = item.url
  const isPlayable = item.kind === "video" || item.kind === "audio" || item.kind === "live"
  // 稳定 streams 数组(video/audio 若已带 stream)。
  const initialStreams = useMemo(() => {
    if (item.kind !== "video" && item.kind !== "audio") return undefined
    return item.stream ? [item.stream] : undefined
  }, [item])

  // 缩略图角标:live 直播中红点;video 时长;其余无(左上 kind 徽标单独放)。
  const thumbBadge =
    item.kind === "live" && item.liveStatus === "live" ? (
      <span className="rounded bg-live px-1.5 py-0.5 text-[11px] font-medium text-white">● 直播中</span>
    ) : item.kind === "video" && item.duration ? (
      <span className="rounded bg-black/70 px-1 py-0.5 text-[10px] font-medium text-white">
        {fmtDuration(item.duration)}
      </span>
    ) : undefined

  const meta = metaLine(item)
  const audioDuration = item.kind === "audio" && item.duration ? fmtAudioDuration(item.duration) : undefined

  return (
    <MediaCard onOpen={url ? () => callbacks.onOpen?.(url) : undefined} className="h-full">
      {/* 16:9 图 + 角标(live 红点右下 / video 时长右下) */}
      <CardThumb
        src={thumbSrc(item)}
        ratio="video"
        alt={item.title}
        badge={thumbBadge}
        badgeClassName="bottom-2 right-2"
      />

      {/* 标题 + 元信息 */}
      <div className="flex min-w-0 flex-col gap-1 px-3 py-2.5">
        <div className="flex min-w-0 items-start gap-1.5">
          <UnreadDot isUnread={item.isUnread ?? true} className="mt-1.5" />
          <h3 className="line-clamp-2 min-w-0 text-sm font-medium leading-snug">{item.title}</h3>
        </div>
        <div className="flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground">
          <span className="rounded bg-muted px-1 py-px text-[10px] font-medium">{KIND_BADGE[item.kind]}</span>
          {meta && <span className="truncate">{meta}</span>}
          {audioDuration && <span className="shrink-0">· {audioDuration}</span>}
          {item.publishedAt && <RelativeTime ts={item.publishedAt} className="ml-auto shrink-0" />}
        </div>
        {item.kind === "social" && item.content && (
          <p className="line-clamp-2 text-xs text-muted-foreground">{item.content}</p>
        )}
      </div>

      {/* 底栏:播放入口(video/audio/live)+ 未读/星标。article/social 只打开原文 */}
      <div className="mt-auto flex items-center justify-between gap-2 px-3 pb-3">
        {isPlayable ? (
          callbacks.onPlayBig ? (
            <button
              className="rounded bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
              onClick={(e) => {
                e.stopPropagation()
                callbacks.onPlayBig!()
              }}
            >
              ▶ 播放
            </button>
          ) : (
            <div className="min-w-0 flex-1" onClick={(e) => e.stopPropagation()}>
              <PlayableMedia
                streams={initialStreams}
                resolve={
                  item.kind === "live"
                    ? callbacks.onResolveLivePlay
                      ? () => callbacks.onResolveLivePlay!(item.roomId)
                      : undefined
                    : callbacks.onResolvePlay
                      ? () => callbacks.onResolvePlay!(item.id)
                      : undefined
                }
              />
            </div>
          )
        ) : (
          <span className="text-xs text-muted-foreground">{item.kind === "social" ? "打开原文" : "阅读"}</span>
        )}
        <div className="flex shrink-0 items-center gap-1">
          {callbacks.onToggleRead && (
            <button
              className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation()
                callbacks.onToggleRead!(item)
              }}
              title={(item.isUnread ?? true) ? "标已读" : "标未读"}
            >
              {(item.isUnread ?? true) ? "已读" : "未读"}
            </button>
          )}
          {callbacks.onToggleStar && (
            <button
              className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation()
                callbacks.onToggleStar!(item)
              }}
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
