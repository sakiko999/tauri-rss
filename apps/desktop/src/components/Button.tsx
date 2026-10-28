/**
 * Button / IconButton —— CVA 变体组件（tailwind-design-system skill 的组件模式）。
 *
 * 2026-10-28 从 30-controls.css 的 `.btn` / `.icon-btn` 类迁出：基础样式 → 变体 →
 * 尺寸 → 状态 → 调用方覆盖（cn 的 tailwind-merge 保证后者胜）。视觉与旧类等价：
 * 高度 34/28、圆角 8、字号 13/11、字重 550、120ms 曲线全部经 @theme 令牌表达。
 */

import { cva, type VariantProps } from "class-variance-authority"
import type { ButtonHTMLAttributes } from "react"

import { cn } from "../lib/cn.ts"

// ⚠️ 按压态用 text-primary-text 而不是 text-primary：primary 压在 primary-soft 上浅色只有
// 3.99:1（13px 正文需 4.5），按下反而更难读；primary-text 浅 4.97 / 深 6.21。
const buttonVariants = cva(
  "inline-flex h-control items-center justify-center gap-2 rounded-md border border-transparent px-3 text-ui font-ui whitespace-nowrap transition-colors duration-[120ms] ease-decel active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 aria-pressed:bg-primary-soft aria-pressed:text-primary-text",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
        secondary: "border-border bg-surface-2 text-foreground hover:border-border-strong hover:bg-surface-3",
        quiet: "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
        danger: "bg-destructive-soft text-destructive hover:bg-destructive hover:text-white",
      },
      size: {
        md: "",
        sm: "h-control-sm px-2 text-ui-sm",
      },
      block: {
        true: "w-full",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
)

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, block, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size, block }), className)} {...props} />
}

const iconButtonVariants = cva(
  "grid size-control flex-none place-items-center rounded-md text-muted-foreground transition-colors duration-[120ms] ease-decel hover:bg-surface-2 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45 aria-pressed:bg-primary-soft aria-pressed:text-primary-text",
  {
    variants: {
      size: {
        md: "",
        sm: "size-control-sm",
      },
    },
    defaultVariants: { size: "md" },
  },
)

export interface IconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof iconButtonVariants> {}

export function IconButton({ className, size, ...props }: IconButtonProps) {
  return <button className={cn(iconButtonVariants({ size }), className)} {...props} />
}
