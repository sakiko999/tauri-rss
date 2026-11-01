/**
 * MediaRateButton —— 倍速菜单按钮(MediaChrome `<media-playback-rate-button>` 的 React 版)。
 *
 * 只读 `state.playbackRate` + 非 live,点开菜单调 `ops.changeRate`。
 * 菜单用播放器浮层原语(键盘导航 / ESC / 焦点管理)。
 */

import { useState } from "react"

import type { VideoOps, VideoPlayState } from "../hooks/useVideoElement.ts"
import { PlayerMenu, PlayerMenuItem } from "../ui/Menu.tsx"
import { usePlayerContainer } from "../ui/PlayerContainer.tsx"

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]

export function MediaRateButton({
  state,
  ops,
  container,
  className = "flex h-[22px] items-center px-1 text-[14px] text-white/80 hover:text-white data-[state=open]:text-white",
}: {
  state: VideoPlayState
  ops: VideoOps
  /** 全屏/小窗时浮层挂载点。 */
  container?: HTMLElement | null
  className?: string
}) {
  const [open, setOpen] = useState(false)
  // 显式 container 优先;否则用播放器容器上下文(全屏内菜单可见)。
  const ctxContainer = usePlayerContainer()
  // 直播没有倍速
  if (state.live) return null
  return (
    <PlayerMenu
      open={open}
      onOpenChange={setOpen}
      container={container ?? ctxContainer}
      trigger={
        // B 站倍速按钮文案恒为「倍速」(不显示当前速率值)。
        <button type="button" aria-label="播放倍速" className={className}>
          倍速
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
