/**
 * Menu —— 下拉菜单封装（radix DropdownMenu + 设计系统类名）。
 * 只许在 `components/ui/**` 里 import Radix，见 `scripts/radix-boundary.check.ts`。
 */

import * as DropdownMenu from "radix-ui/dropdown-menu"
import { type ReactNode } from "react"

import { Icon } from "../Icon.tsx"

/** 下拉菜单(单选高亮 + 分隔 + 快捷键提示)。 */
export function Menu({
  trigger,
  children,
  align = "end",
}: {
  trigger: ReactNode
  children: ReactNode
  align?: "start" | "end"
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        {/* 定位完全交给 Radix 的 popper wrapper（data-radix-popper-content-wrapper）。
            ⚠️ `.menu` 自己不能写 position: fixed/absolute —— 那会让它脱离 wrapper
            的文档流，wrapper 量成 0×0，flip / available-height / 水平对齐全算错
            （底部行被压成带滚动条的矮菜单，且 align=end 向右溢出）。 */}
        <DropdownMenu.Content
          align={align}
          sideOffset={6}
          // Radix 默认会 flip/shift，但 collisionPadding=0 时会贴着视口边缘。
          // 留 10px 安全边距；空间不足时 CSS 再用 available-height 限高并内部滚动。
          collisionPadding={10}
          className="menu"
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

export function MenuItem({
  onSelect,
  checked,
  hint,
  icon,
  danger,
  children,
  disabled,
}: {
  onSelect?: () => void
  checked?: boolean
  hint?: string
  icon?: string
  danger?: boolean
  children: ReactNode
  disabled?: boolean
}) {
  return (
    <DropdownMenu.Item
      className="menu-item"
      disabled={disabled}
      onSelect={onSelect}
      style={danger ? { color: "var(--color-destructive)" } : undefined}
    >
      {icon ? <Icon name={icon} size={14} /> : null}
      <span className="flex-1">{children}</span>
      {checked ? <Icon name="check" size={13} className="check" /> : null}
      {hint ? <span className="menu-hint">{hint}</span> : null}
    </DropdownMenu.Item>
  )
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="menu-sep" />
}
