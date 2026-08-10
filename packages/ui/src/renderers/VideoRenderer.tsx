/**
 * VideoRenderer — 视频条目卡片。展示封面/频道/时长/摘要 + 内嵌播放。
 * 播放直链需懒解析(deadline 签名):点击「播放」经 onResolvePlay 拿流。
 * 样式走 Tailwind 4 类(令牌见 styles/theme.css,desktop 经 @source 扫到)。
 */
import type { VideoItem } from "@tauri-playground/core"
import type { RendererCallbacks } from "./types.ts"
import { PlayableMedia } from "../player/PlayableMedia.tsx"

function fmtDuration(sec?: number): string {
  if (sec === undefined) return ""
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const mm = String(m).padStart(2, "0")
  const ss = String(s).padStart(2, "0")
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function VideoRenderer({
  item,
  onOpen,
  onToggleRead,
  onToggleStar,
  onResolvePlay,
  onPlayBig,
}: { item: VideoItem } & RendererCallbacks) {
  return (
    <article
      className="mb-2 cursor-pointer rounded-lg border border-zinc-200 p-3 hover:bg-zinc-50"
      onClick={() => item.url && onOpen?.(item.url)}
    >
      <div className="flex gap-3">
        {item.poster && (
          <img
            src={item.poster}
            alt=""
            className="h-[68px] w-[120px] flex-shrink-0 rounded object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="m-0 text-base font-medium">{item.title}</h3>
            <span className="shrink-0 rounded border border-zinc-300 px-1.5 text-xs text-zinc-500">video</span>
          </div>
          <div className="mt-1 flex gap-3 text-xs text-zinc-500">
            {item.channel?.name && <span>{item.channel.name}</span>}
            {fmtDuration(item.duration) && <span>{fmtDuration(item.duration)}</span>}
            {item.publishedAt && <span>{new Date(item.publishedAt).toLocaleDateString()}</span>}
          </div>
          {item.summary && <p className="mt-2 text-sm text-zinc-600">{item.summary}</p>}
          {/* 播放入口:宿主提供 onPlayBig → 大屏模态(不内嵌小播放器);否则内嵌播放 */}
          {onPlayBig ? (
            <div className="mt-2 flex gap-2">
              <button
                className="rounded bg-zinc-900 px-3 py-1 text-sm text-white hover:bg-zinc-700"
                onClick={(e) => {
                  e.stopPropagation()
                  onPlayBig()
                }}
              >
                ▶ 大屏播放
              </button>
            </div>
          ) : (
            <div className="mt-2" onClick={(e) => e.stopPropagation()}>
              <PlayableMedia
                streams={item.stream ? [item.stream] : undefined}
                resolve={onResolvePlay ? () => onResolvePlay!(item.id) : undefined}
              />
            </div>
          )}
          <div className="mt-2 flex gap-2">
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
        </div>
      </div>
    </article>
  )
}
