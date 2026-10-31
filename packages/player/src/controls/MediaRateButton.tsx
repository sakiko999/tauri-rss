/**
 * MediaRateButton —— 倍速菜单按钮(MediaChrome `<media-playback-rate-button>` 的 React 版)。
 *
 * 只读 `state.playbackRate` + 非 live,点开菜单调 `ops.changeRate`。
 * 菜单用播放器浮层原语(键盘导航 / ESC / 焦点管理)。
 */

import { useState } from "react"

import type { VideoOps, VideoPlayState } from "../hooks/useVideoElement.ts"
import { PlayerMenu, PlayerMenuItem } from "../ui/Menu.tsx"

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]

export function MediaRateButton({
  state,
  ops,
  className = "rounded px-1.5 py-1 text-xs hover:bg-white/20",
}: {
  state: VideoPlayState
  ops: VideoOps
  className?: string
}) {
  const [open, setOpen] = useState(false)
  // 直播没有倍速
  if (state.live) return null
  return (
    <PlayerMenu
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button type="button" aria-label="播放倍速" className={`data-[state=open]:bg-white/20 ${className}`}>
          {state.playbackRate}×
        </button>
      }
    >
      {PLAYBACK_RATES.map((rate) => (
        <PlayerMenuItem
          key={rate}
          active={Math.abs(state.playbackRate - rate) < 0.001}
          onSelect={() => ops.changeRate(rate)}
        >
          {rate}×
        </PlayerMenuItem>
      ))}
    </PlayerMenu>
  )
}
