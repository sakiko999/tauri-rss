/**
 * MediaVolumeSlider —— 音量滑条(MediaChrome `<media-volume-range>` 的 React 版)。
 *
 * 形态:垂直滑条,位于 mute 按钮上方;**仅 hover mute 按钮本身时显示**。
 * 用 React 状态(onMouseEnter/Leave 挂在按钮包裹 div)而非 CSS `group-hover`——
 * 后者是父级链式触发,VideoShell 容器有 `group` 类,鼠标进 video 区就会误触。
 * 独立可组合:只读 `state.volume/muted`,拖动调 `ops.changeVolume`。
 */
import { useState } from "react"
import type { VideoOps, VideoPlayState } from "../hooks/useVideoElement.ts"
import { MediaMuteButton } from "./MediaMuteButton.tsx"

export function MediaVolumeSlider({
  state,
  ops,
}: {
  state: VideoPlayState
  ops: VideoOps
}) {
  const [open, setOpen] = useState(false)
  const volumePct = Math.round((state.muted ? 0 : state.volume) * 100)
  return (
    <div
      className="relative flex items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <MediaMuteButton state={state} ops={ops} />
      {/* 垂直滑条浮层:仅按钮 hover 显示(React 状态,不受祖先 group 影响) */}
      {open && (
        <div className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 rounded bg-black/80 p-2">
          <input
            type="range"
            min={0}
            max={100}
            value={volumePct}
            onChange={(e) => ops.changeVolume(Number(e.target.value) / 100)}
            aria-label="音量"
            aria-orientation="vertical"
            className="h-24 w-1 cursor-pointer accent-white"
            style={{ writingMode: "vertical-lr", direction: "rtl" }}
          />
        </div>
      )}
    </div>
  )
}
