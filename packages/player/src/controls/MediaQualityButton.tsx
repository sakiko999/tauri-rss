/**
 * MediaQualityButton —— 清晰度档位菜单(MediaChrome `<media-settings-menu>` 的轻量 React 版)。
 *
 * 消费多档位列表(rate + quality),选中调 `onQuality`。少于 2 档不渲染。
 * 菜单用播放器浮层原语（全屏时需传 container）。
 */

import { useState } from "react"

import { PlayerMenu, PlayerMenuItem } from "../ui/Menu.tsx"
import { usePlayerContainer } from "../ui/PlayerContainer.tsx"

export function MediaQualityButton({
  qualityOptions,
  activeQuality,
  onQuality,
  container,
  className = "flex h-[22px] items-center px-2.5 text-[14px] text-white/80 hover:text-white data-[state=open]:text-white",
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
  // 显式 container 优先;否则用播放器容器上下文(全屏内菜单可见,见 PlayerContainer.tsx)。
  const ctxContainer = usePlayerContainer()
  if (qualityOptions.length < 2) return null
  return (
    <PlayerMenu
      open={open}
      onOpenChange={setOpen}
      container={container ?? ctxContainer}
      // 宽度随内容自适应(最小 96px);B 站的 169px 是为了右侧会员/登录徽标留位,
      // 我们没有徽标,固定宽度会显得空且过大。
      contentClassName="min-w-24 max-w-60"
      trigger={
        <button type="button" aria-label="清晰度" className={className}>
          {qualityOptions.find((q) => q.rate === activeQuality)?.quality ?? "清晰度"}
        </button>
      }
    >
      {qualityOptions.map(({ rate, quality }) => (
        <PlayerMenuItem
          key={rate}
          size="sm"
          align="start"
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
