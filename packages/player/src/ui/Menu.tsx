/**
 * 播放器浮层原语（radix DropdownMenu 封装）。
 *
 * ⚠️ 本目录是 packages/player 里**唯一**允许 import Radix 的地方
 * （`scripts/radix-boundary.check.ts`）。
 * ⚠️ 全屏时 Radix 默认 Portal 到 document.body —— 全屏元素之外的内容不可见。
 * 调用方必须把当前播放器容器（播放页/小窗/全屏元素）经 `container` 传进来，
 * 由 `VideoShell` 统一提供（P0a-2）；不传保持现状（只有非全屏可见）。
 */

import * as DropdownMenu from "radix-ui/dropdown-menu"
import type { ReactNode } from "react"

export const PLAYER_MENU_CONTENT_CLS =
  "z-50 min-w-16 rounded-md border border-white/15 bg-black/95 py-1 text-xs text-white shadow-xl"
export const PLAYER_MENU_ITEM_CLS =
  "flex w-full select-none items-center justify-center px-3 py-1.5 text-left outline-none hover:bg-white/15 focus:bg-white/15"

export function PlayerMenu({
  open,
  onOpenChange,
  trigger,
  container,
  side = "top",
  align = "end",
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: ReactNode
  /** 全屏/小窗时浮层的挂载点；不传 = document.body。 */
  container?: HTMLElement | null
  side?: "top" | "bottom"
  align?: "start" | "end"
  children: ReactNode
}) {
  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal {...(container ? { container } : {})}>
        <DropdownMenu.Content side={side} align={align} sideOffset={4} className={PLAYER_MENU_CONTENT_CLS}>
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

export function PlayerMenuItem({
  onSelect,
  active = false,
  children,
}: {
  onSelect?: () => void
  active?: boolean
  children: ReactNode
}) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className={`${PLAYER_MENU_ITEM_CLS} ${active ? "text-blue-400" : "text-white/90"}`}
    >
      {children}
    </DropdownMenu.Item>
  )
}
