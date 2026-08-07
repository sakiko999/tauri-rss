/**
 * AudioRenderer — 音频/播客条目标题/封面/艺术家/时长 + 内嵌播放。
 * 播放直链可直接用(播客 mp3 无签名),经 PlayableMedia 原生 <audio>。
 * 样式走 Tailwind 4 类。
 */
import type { AudioItem } from "@tauri-playground/core"
import type { RendererCallbacks } from "./types.ts"
import { PlayableMedia } from "../player/PlayableMedia.tsx"

function fmtDuration(sec?: number): string {
  if (sec === undefined) return ""
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

export function AudioRenderer({
  item,
  onOpen,
  onToggleRead,
  onToggleStar,
}: { item: AudioItem } & RendererCallbacks) {
  return (
    <article
      className="mb-2 cursor-pointer rounded-lg border border-zinc-200 p-3 hover:bg-zinc-50"
      onClick={() => item.url && onOpen?.(item.url)}
    >
      <div className="flex gap-3">
        {item.thumbnail && (
          <img
            src={item.thumbnail}
            alt=""
            className="h-20 w-20 flex-shrink-0 rounded object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="m-0 truncate text-base font-medium">{item.title}</h3>
            <span className="shrink-0 rounded border border-zinc-300 px-1.5 text-xs text-zinc-500">audio</span>
          </div>
          <div className="mt-1 flex gap-3 text-xs text-zinc-500">
            {(item.artist || item.author?.name) && <span>{item.artist ?? item.author?.name}</span>}
            {fmtDuration(item.duration) && <span>{fmtDuration(item.duration)}</span>}
            {item.publishedAt && <span>{new Date(item.publishedAt).toLocaleDateString()}</span>}
          </div>
          {/* 内嵌播放:有初始 stream 直接原生 <audio> */}
          <div className="mt-2" onClick={(e) => e.stopPropagation()}>
            <PlayableMedia streams={item.stream ? [item.stream] : undefined} />
          </div>
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
