/**
 * ExpandedPlayer — 模态浮层大播放器。
 *
 * 「点击播放放大」的宿主实现:全屏遮罩 + 居中大播放器(约 70% 宽)。
 * 由 MediaList 持有 expanded 状态,播放器 key 绑 item.id —— 打开即
 * autoResolve 懒解析起播(点按钮时用户已在手势内,无需再点「播放」)。
 *
 * 关闭:ESC / 遮罩点击 / ✕ 按钮。播放器生命周期随挂载卸载(懒解析只在打开时发生)。
 * 打开期间禁用页面滚动(overflow hidden),关闭恢复。
 */
import { useEffect } from "react"
import type { MediaItem, MediaStream } from "@tauri-playground/core"
import { PlayableMedia } from "@tauri-playground/player"

export function ExpandedPlayer({
  item,
  resolvePlay,
  resolveLivePlay,
  onClose,
}: {
  item: MediaItem
  /** 懒解析 video 可播流(绑定 item.subscriptionId)。 */
  resolvePlay: (itemId: string) => Promise<MediaStream[]>
  /** 懒解析 live 可播流。 */
  resolveLivePlay: (roomId: string) => Promise<MediaStream[]>
  onClose: () => void
}) {
  // 打开模态的这次点击本身即手势 → 手势内解锁 autoplay 已在 MediaList.openExpanded
  // (setExpandedItem 前,同步手势内)完成,autoResolve 完成后带声起播。
  // ESC 关闭 + 滚动锁定。依赖 onClose 会因父级重渲染重建 → 用 ref 持最新。
  const onCloseRef = { current: onClose }
  onCloseRef.current = onClose
  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current()
    }
    window.addEventListener("keydown", onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener("keydown", onKey)
    }
  }, [])

  const resolve = item.kind === "live" ? () => resolveLivePlay(item.roomId) : () => resolvePlay(item.id)
  // 初始流:仅 video/audio 有 stream 字段(联合类型收窄)。
  const initialStream =
    item.kind === "video" || item.kind === "audio" ? (item.stream ? [item.stream] : undefined) : undefined
  // 来源行:live 显示房间号;video 显示 channel;其余显示作者。
  const sourceLine =
    item.kind === "live"
      ? `房间 ${item.roomId}`
      : item.kind === "video"
        ? item.channel?.name ?? ""
        : item.author?.name ?? ""

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
      onClick={(e) => {
        // 点遮罩(非播放器区域)关闭。
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="relative w-[min(72rem,90vw)]">
        {/* 标题栏 + 关闭 */}
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="truncate text-sm font-medium text-white/90">{item.title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded px-2 py-1 text-sm text-white/70 hover:bg-white/15 hover:text-white"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        {/* 大播放器:key 绑 item.id,打开即全新挂载 → autoResolve 起播。
            外层 relative aspect-video 定 16:9(父 w-[min(72rem,90vw)] 用 vw 首帧
            即确定,避免子 VideoShell 自撑在首帧父宽未就绪时塌成扁黑条);
            PlayableMedia fill → VideoShell absolute 填满本层(relative 定位祖先)。 */}
        <div key={item.id} className="relative aspect-video overflow-hidden rounded-lg bg-black shadow-2xl">
          <PlayableMedia
            streams={initialStream}
            resolve={resolve}
            autoResolve
            fill
            onError={(err) => console.warn("[ExpandedPlayer] 播放失败:", err)}
          />
        </div>

        {/* 元信息:播放完成后还能看到来源/时间 */}
        <div className="mt-2 flex items-center justify-between text-xs text-white/50">
          <span className="truncate">{sourceLine}</span>
          {item.publishedAt && <span className="shrink-0 pl-3">{new Date(item.publishedAt).toLocaleString()}</span>}
        </div>
      </div>
    </div>
  )
}
