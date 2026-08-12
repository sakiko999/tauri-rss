/**
 * MediaRateButton —— 倍速菜单按钮(MediaChrome `<media-playback-rate-button>` 的 React 版)。
 *
 * 只读 `state.playbackRate` + 非 live,点开菜单调 `ops.changeRate`。
 * 菜单用 radix DropdownMenu(键盘导航 / ESC / 焦点管理)。
 */
import { useState } from "react"
import * as DropdownMenu from "@radix-ui/react-dropdown-menu"
import type { VideoOps, VideoPlayState } from "../hooks/useVideoElement.ts"

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]

const MENU_CONTENT_CLS = "z-50 min-w-16 rounded-md border border-white/15 bg-black/95 py-1 text-xs text-white shadow-xl"
const MENU_ITEM_CLS = "flex w-full select-none items-center justify-center px-3 py-1.5 text-left outline-none hover:bg-white/15 focus:bg-white/15"

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
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild className={`data-[state=open]:bg-white/20 ${className}`}>
        <button type="button" aria-label="播放倍速">
          {state.playbackRate}×
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side="top" align="end" sideOffset={4} className={MENU_CONTENT_CLS}>
          {PLAYBACK_RATES.map((rate) => (
            <DropdownMenu.Item
              key={rate}
              onSelect={() => ops.changeRate(rate)}
              className={`${MENU_ITEM_CLS} ${
                Math.abs(state.playbackRate - rate) < 0.001 ? "text-blue-400" : "text-white/90"
              }`}
            >
              {rate}×
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
