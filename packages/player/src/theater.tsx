/**
 * TheaterIconButton —— 宽屏(剧场)模式开关(B 站控件栏的「宽屏模式」按钮)。
 *
 * 状态归宿主(播放页布局,如收起右栏);播放器只画按钮。宿主不传 theater 时按钮
 * 不渲染 —— 不是所有宿主都有「宽屏」概念(小窗/移动)。
 */

import { TheaterIcon } from "./icons.tsx"

export function TheaterIconButton({ theater }: { theater?: { on: boolean; toggle: () => void } }) {
  if (!theater) return null
  return (
    <button
      type="button"
      aria-label="宽屏模式"
      aria-pressed={theater.on}
      title={theater.on ? "退出宽屏" : "宽屏模式"}
      onClick={theater.toggle}
      className={`flex h-[22px] w-9 items-center justify-center ${theater.on ? "text-[#00aeec]" : "text-white/80 hover:text-white"}`}
    >
      <TheaterIcon className="h-[22px] w-[22px]" />
    </button>
  )
}
