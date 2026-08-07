/**
 * LiveRenderer — 直播房间卡片。展示状态/在线/介绍 + 内嵌播放。
 * playUrls 懒解析(带 expiry 签名):点击「播放」经 onResolveLivePlay 拿流。
 * 样式走 Tailwind 4 类。
 */
import type { LiveItem } from "@tauri-playground/core"
import type { RendererCallbacks } from "./types.ts"
import { PlayableMedia } from "../player/PlayableMedia.tsx"

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
}: { item: LiveItem } & RendererCallbacks) {
  const isLive = item.liveStatus === "live"
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
            className="h-[68px] w-[120px] flex-shrink-0 rounded object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="m-0 truncate text-base font-medium">{item.title || item.roomId}</h3>
            {isLive ? (
              <span className="shrink-0 rounded bg-live px-1.5 text-xs text-white">{STATUS_LABEL[item.liveStatus]}</span>
            ) : (
              <span className="shrink-0 rounded border border-zinc-300 px-1.5 text-xs text-zinc-500">{STATUS_LABEL[item.liveStatus]}</span>
            )}
          </div>
          <div className="mt-1 flex gap-3 text-xs text-zinc-500">
            <span>{item.platform}</span>
            <span>房间 {item.roomId}</span>
            {item.online !== undefined && <span>在线 {item.online}</span>}
          </div>
          {item.introduction && <p className="mt-2 text-sm text-zinc-600">{item.introduction}</p>}
          {/* 内嵌播放:直播流懒解析(roomId);未开播时 resolve 可能返回空 */}
          <div className="mt-2" onClick={(e) => e.stopPropagation()}>
            <PlayableMedia resolve={onResolveLivePlay ? () => onResolveLivePlay!(item.roomId) : undefined} />
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
