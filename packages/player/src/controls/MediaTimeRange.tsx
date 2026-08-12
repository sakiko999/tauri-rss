/**
 * MediaTimeRange —— 自定义进度条(Seek/缓冲展示/悬停预览/拖拽)。
 * MediaChrome `<media-time-range>` 的 React 版。窄接口 `{state, ops}`,独立可组合。
 *
 * 不依赖 `<input type=range>` 的原生样式(跨 webview 不统一),用 div 实现:
 *   - 底部轨道:已缓冲段(半透明白)+ 已播放段(白实心),横向百分比宽度。
 *   - 悬停:显示「预览时间」tooltip + 时间轴 hover 细线,点击/拖拽 seek。
 *   - 键盘:←/→(5s)、Home/End(起点/终点)、PageUp/PageDown(±10%)。
 *   - live:进度条退化为缓冲指示(不可拖拽),单独用「LIVE」按钮跳边缘。
 *
 * 交互:pointerdown 即 seek(不用等 move),pointermove 拖动时持续 seek,
 * pointerup 释放。用 pointer capture 保证拖出元素仍跟手。
 */
import { useCallback, useRef, useState } from "react"
import type { VideoOps, VideoPlayState } from "../hooks/useVideoElement.ts"
import { formatTime } from "../utils/time.ts"
import { playableDuration } from "../utils/buffer.ts"

const STEP_SEC = 5
const PAGE_RATIO = 0.1

export function MediaTimeRange({
  state,
  ops,
}: {
  state: VideoPlayState
  ops: VideoOps
}) {
  const [hoverPct, setHoverPct] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const trackRef = useRef<HTMLDivElement | null>(null)

  const duration = playableDuration(state)
  const pct = duration > 0 ? Math.min(100, (state.currentTime / duration) * 100) : 0
  const bufferPct = duration > 0 ? Math.min(100, (state.bufferedEnd / duration) * 100) : 0

  /** clientX → 进度百分比 0..100。悬停线/tooltip 直接用;seek 换算时 /100。 */
  const pctFromEvent = useCallback((clientX: number) => {
    const el = trackRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    const x = clientX - rect.left
    return Math.max(0, Math.min(100, (x / rect.width) * 100))
  }, [])

  const seekFromEvent = useCallback(
    (clientX: number) => {
      const p = pctFromEvent(clientX)
      const t = (p / 100) * playableDuration(state)
      ops.seek(t)
    },
    [pctFromEvent, ops, state.live, state.bufferedEnd, state.duration],
  )

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (state.live) return // 直播不 seek,进度条仅作缓冲指示
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    setDragging(true)
    seekFromEvent(e.clientX)
  }
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (state.live) return
    setHoverPct(pctFromEvent(e.clientX))
    if (dragging) seekFromEvent(e.clientX)
  }
  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (state.live) return
    setDragging(false)
    seekFromEvent(e.clientX)
    try {
      ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      // ignore
    }
  }
  const handlePointerLeave = () => {
    if (!dragging) setHoverPct(null)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (state.live) return
    let next: number | null = null
    switch (e.key) {
      case "ArrowLeft":
        next = state.currentTime - STEP_SEC
        break
      case "ArrowRight":
        next = state.currentTime + STEP_SEC
        break
      case "Home":
        next = 0
        break
      case "End":
        next = duration
        break
      case "PageDown":
        next = state.currentTime - PAGE_RATIO * duration
        break
      case "PageUp":
        next = state.currentTime + PAGE_RATIO * duration
        break
      default:
        return
    }
    e.preventDefault()
    ops.seek(next)
  }

  const shownPct = dragging ? hoverPct ?? pct : hoverPct ?? null

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label="播放进度"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(state.currentTime)}
      aria-valuetext={formatTime(state.currentTime)}
      aria-disabled={state.live}
      className="group relative flex h-5 w-full cursor-pointer touch-none items-center outline-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onKeyDown={handleKeyDown}
    >
      {/* 轨道 */}
      <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/25 transition-[height] group-hover:h-1.5">
        {/* 已缓冲段 */}
        {bufferPct > 0 && (
          <div className="absolute inset-y-0 left-0 bg-white/35" style={{ width: `${bufferPct}%` }} />
        )}
        {/* 已播放段 */}
        <div className="absolute inset-y-0 left-0 bg-white" style={{ width: `${pct}%` }} />
        {/* 悬停位置细线 */}
        {shownPct !== null && (
          <div className="absolute inset-y-0 bg-white/70" style={{ left: `${shownPct}%`, width: 2 }} />
        )}
      </div>
      {/* 播放头 */}
      <div
        className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 shadow transition-opacity group-hover:opacity-100"
        style={{ left: `${pct}%` }}
      />
      {/* 悬停时间 tooltip:锚到轨道中心(容器垂直中线的 top-1/2),
          向上平移 100% 高度 + 8px 间距,与 hover 点正对。 */}
      {shownPct !== null && !state.live && (
        <div
          className="pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-[calc(100%+8px)] rounded bg-black/80 px-1.5 py-0.5 text-[10px] tabular-nums text-white"
          style={{ left: `${shownPct}%` }}
        >
          {formatTime(shownPct * duration)}
        </div>
      )}
    </div>
  )
}
