/**
 * MediaQualityButton —— 清晰度档位菜单(MediaChrome `<media-settings-menu>` 的轻量 React 版)。
 *
 * 消费多档位列表(rate + quality),选中调 `onQuality`。少于 2 档不渲染。
 * 菜单用 radix DropdownMenu。
 */
import { useState } from "react"
import * as DropdownMenu from "@radix-ui/react-dropdown-menu"

const MENU_CONTENT_CLS = "z-50 min-w-24 rounded-md border border-white/15 bg-black/95 py-1 text-xs text-white shadow-xl"
const MENU_ITEM_CLS = "flex w-full select-none items-center justify-center px-3 py-1.5 text-left outline-none hover:bg-white/15 focus:bg-white/15"

export function MediaQualityButton({
  qualityOptions,
  activeQuality,
  onQuality,
  className = "rounded px-1.5 py-1 text-xs hover:bg-white/20",
}: {
  /** 多档位列表(rate + quality);长度 < 2 时不显示。 */
  qualityOptions: { rate: number; quality: string }[]
  activeQuality?: number
  onQuality: (rate: number) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  if (qualityOptions.length < 2) return null
  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild className={`data-[state=open]:bg-white/20 ${className}`}>
        <button type="button" aria-label="清晰度">
          {qualityOptions.find((q) => q.rate === activeQuality)?.quality ?? "清晰度"}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side="top" align="end" sideOffset={4} className={MENU_CONTENT_CLS}>
          {qualityOptions.map(({ rate, quality }) => (
            <DropdownMenu.Item
              key={rate}
              onSelect={() => {
                onQuality(rate)
                setOpen(false)
              }}
              className={`${MENU_ITEM_CLS} ${
                rate === activeQuality ? "text-blue-400" : "text-white/90"
              }`}
            >
              {quality}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
