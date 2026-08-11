/**
 * Skeleton — 加载占位(shimmer)。
 * 纯 CSS:animate-pulse(Tailwind 内置)+ zinc 灰阶,明暗自适配。
 * 用于图片/文本加载前的占位,配合 aspect-ratio 撑开高度防布局跳动。
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-zinc-200/70 dark:bg-zinc-800/70 ${className ?? ""}`} />
}
