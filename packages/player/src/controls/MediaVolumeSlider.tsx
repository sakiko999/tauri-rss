/**
 * MediaVolumeSlider —— 音量(按钮 + 垂直滑条浮层)。
 *
 * 浮层形态对齐 B 站播放器实测(2026-11-01):
 *   - 32×100、`rgba(20,20,20,.9)`、2px 圆角;顶部 **音量数字**(32×28);
 *   - 轨道 **2px 浅灰(#e7e7e7)**(60px 高)、滑块 **12px 蓝色圆点(#00AEEC)**;
 *   - 浮层以按钮为轴居中、距按钮 8px。
 * 自绘滑条(不用 `<input type=range>`):原生控件在 WebView2 上轨道/滑块是粗蓝条,
 * 与 B 站观感差得远,且跨 WebView 表现不统一。
 *
 * 仅 hover 按钮(或浮层)时显示(React 状态,不受祖先 group 影响)。
 */

import { useCallback, useRef, useState } from "react"

import type { VideoOps, VideoPlayState } from "../hooks/useVideoElement.ts"
import { MediaMuteButton } from "./MediaMuteButton.tsx"

const TRACK_H = 60

export function MediaVolumeSlider({ state, ops }: { state: VideoPlayState; ops: VideoOps }) {
  const [open, setOpen] = useState(false)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const volumePct = Math.round((state.muted ? 0 : state.volume) * 100)

  /** 由指针位置换算音量(顶部 = 100%)。 */
  const setFromY = useCallback(
    (clientY: number) => {
      const el = trackRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      if (r.height <= 0) return
      ops.changeVolume(Math.max(0, Math.min(1, 1 - (clientY - r.top) / r.height)))
    },
    [ops],
  )

  const nudge = (delta: number) => ops.changeVolume(Math.max(0, Math.min(1, (state.muted ? 0 : state.volume) + delta)))

  return (
    <div className="relative flex items-center" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <MediaMuteButton
        state={state}
        ops={ops}
        className="flex h-[22px] w-10 items-center justify-center text-white/80 hover:text-white"
      />
      {open && (
        <div className="absolute bottom-full left-1/2 mb-2 flex h-[100px] w-8 -translate-x-1/2 flex-col items-center rounded-[2px] bg-[#141414]/90">
          {/* 音量数字(B 站 32×28 区域,12px #e5e9ef) */}
          <span className="flex h-7 items-center text-xs text-[#e5e9ef] tabular-nums">{volumePct}</span>
          {/* 垂直滑条区:32×60;轨道 2px,滑块 12px 蓝点 */}
          <div
            ref={trackRef}
            role="slider"
            tabIndex={0}
            aria-label="音量"
            aria-orientation="vertical"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={volumePct}
            className="relative flex w-full cursor-pointer touch-none items-center justify-center outline-none"
            style={{ height: TRACK_H }}
            onPointerDown={(e) => {
              e.preventDefault()
              ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
              setFromY(e.clientY)
            }}
            onPointerMove={(e) => {
              if (e.buttons) setFromY(e.clientY)
            }}
            onPointerUp={(e) => {
              setFromY(e.clientY)
              try {
                ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
              } catch {
                // ignore
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp" || e.key === "ArrowRight") {
                e.preventDefault()
                nudge(0.05)
              } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
                e.preventDefault()
                nudge(-0.05)
              }
            }}
          >
            {/* 轨道 2px 浅灰 + **已调节部分 2px 蓝色**(B 站 .bui-bar,从底部到滑块) */}
            <div className="relative h-full w-0.5 overflow-hidden rounded-[1.5px] bg-[#e7e7e7]">
              <div className="absolute inset-x-0 bottom-0 bg-[#00aeec]" style={{ height: `${volumePct}%` }} />
            </div>
            <div
              className="pointer-events-none absolute left-1/2 h-3 w-3 -translate-x-1/2 rounded-full bg-[#00aeec]"
              style={{ bottom: `calc(${volumePct}% - 6px)` }}
            />
          </div>
          {/* 底部 12px 留白(B 站 100 = 28 + 60 + 12) */}
          <div className="h-3" />
        </div>
      )}
    </div>
  )
}
