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

/**
 * 弹窗视觉 = B 站播放器实测(2026-11-01,打开态 computed style):
 *   - 容器 `rgba(20,20,20,.9)` / 2px 圆角 / 无边框无阴影;
 *   - **以触发按钮为轴居中**(菜单中心 = 按钮中心),底边距按钮 9px;
 *   - 条目 36px 高、hover 白 10%、选中 **#00AEEC**;
 *   - 倍速条:宽 70px、14px、文字居中;
 *   - 清晰度条:宽 169px、12px、**左对齐 + 左右 12px 内边距**(B 站右侧还有
 *     大会员/登录徽标,我们没有对应概念,不放)。
 */
export const PLAYER_MENU_CONTENT_CLS = "z-50 rounded-[2px] bg-[#141414]/90 py-0 text-white"
export const PLAYER_MENU_ITEM_CLS =
  "flex h-9 w-full cursor-pointer select-none items-center whitespace-nowrap outline-none hover:bg-white/10 focus:bg-white/10"

export function PlayerMenu({
  open,
  onOpenChange,
  trigger,
  container,
  side = "top",
  align = "center",
  contentClassName,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: ReactNode
  /** 全屏/小窗时浮层的挂载点；不传 = document.body。 */
  container?: HTMLElement | null
  side?: "top" | "bottom"
  align?: "start" | "center" | "end"
  /** 菜单宽度等(B 站:倍速 70px / 清晰度 169px)。 */
  contentClassName?: string
  children: ReactNode
}) {
  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal {...(container ? { container } : {})}>
        <DropdownMenu.Content
          side={side}
          align={align}
          sideOffset={8}
          className={[PLAYER_MENU_CONTENT_CLS, contentClassName].filter(Boolean).join(" ")}
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

export function PlayerMenuItem({
  onSelect,
  active = false,
  size = "md",
  align = "center",
  children,
}: {
  onSelect?: () => void
  active?: boolean
  /** 字号档:B 站倍速 14px / 清晰度 12px。 */
  size?: "sm" | "md"
  /** 文本对齐:B 站倍速居中、清晰度左对齐(12px 内边距)。 */
  align?: "center" | "start"
  children: ReactNode
}) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className={`${PLAYER_MENU_ITEM_CLS} ${align === "start" ? "justify-start px-3" : "justify-center"} ${
        size === "sm" ? "text-xs" : "text-[14px]"
      } ${active ? "text-[#00aeec]" : "text-white"}`}
    >
      {children}
    </DropdownMenu.Item>
  )
}
