/**
 * cn — className 合并（tailwind-design-system skill 的标准工具）。
 *
 * clsx 处理条件类，tailwind-merge 消解冲突类（后写的同类工具类胜出，
 * 如组件默认 `p-4` 与调用方覆盖 `p-6`）。CVA 变体组件（cva()）的输出也走这里。
 */

import { type ClassValue, clsx } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * `styles/10-tokens.css` 的 `@theme` 里 tailwind-merge 默认配置认不出的自定义令牌。
 *
 * ⚠️ 不登记的后果（2026-11-01 实测）：`text-ui` 被当成**颜色**类，与 `text-foreground`
 * 互相覆盖 —— md Button 丢 13px 字号（继承 body 15px），sm Button 丢文字色。
 * 在这几个命名空间（text/spacing/font-weight/shadow/ease/animate）加令牌要同步这里；
 * `cn.check.ts` 按 CSS 反查，漏登记直接失败。颜色（color: isAny）、圆角/字体族
 * （默认 T 恤尺码/任意名）不用登记。
 */
export const TW_THEME_EXTEND = {
  text: ["ui", "ui-sm"],
  spacing: ["control", "control-sm"],
  "font-weight": ["ui"],
  shadow: ["1", "2", "pop"],
  ease: ["heliu", "decel", "accel"],
  animate: ["rise", "fade", "shimmer", "pulse-soft", "modal-in"],
}

const twMerge = extendTailwindMerge({ extend: { theme: TW_THEME_EXTEND } })

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
