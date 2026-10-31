/**
 * MediaQualityButton —— 清晰度档位菜单(MediaChrome `<media-settings-menu>` 的轻量 React 版)。
 *
 * 消费多档位列表(rate + quality),选中调 `onQuality`。少于 2 档不渲染。
 * 菜单用播放器浮层原语（全屏时需传 container）。
 */

import { useState } from "react"

import { PlayerMenu, PlayerMenuItem } from "../ui/Menu.tsx"

export function MediaQualityButton({
  qualityOptions,
  activeQuality,
  onQuality,
  container,
  className = "rounded px-1.5 py-1 text-xs hover:bg-white/20",
}: {
  /** 多档位列表(rate + quality);长度 < 2 时不显示。 */
  qualityOptions: { rate: number; quality: string }[]
  activeQuality?: number
  onQuality: (rate: number) => void
  /** 全屏/小窗时浮层挂载点。 */
  container?: HTMLElement | null
  className?: string
}) {
  const [open, setOpen] = useState(false)
  if (qualityOptions.length < 2) return null
  return (
    <PlayerMenu
      open={open}
      onOpenChange={setOpen}
      container={container}
      trigger={
        <button type="button" aria-label="清晰度" className={`data-[state=open]:bg-white/20 ${className}`}>
          {qualityOptions.find((q) => q.rate === activeQuality)?.quality ?? "清晰度"}
        </button>
      }
    >
      {qualityOptions.map(({ rate, quality }) => (
        <PlayerMenuItem
          key={rate}
          active={rate === activeQuality}
          onSelect={() => {
            onQuality(rate)
            setOpen(false)
          }}
        >
          {quality}
        </PlayerMenuItem>
      ))}
    </PlayerMenu>
  )
}
