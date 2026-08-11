/**
 * UnreadDot — 未读状态圆点(参考 Folo GridItemFooter)。
 * 未读:accent 蓝圆点(从卡片背景跳出);已读:收缩为 0 宽(opacity 过渡)。
 * 用 span 撑 inline 布局,占用宽度动画不破坏行高。
 */
export function UnreadDot({ isUnread, className }: { isUnread: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={[
        "inline-block h-1.5 shrink-0 rounded-full bg-blue-500 transition-all duration-200",
        isUnread ? "w-1.5 opacity-100" : "w-0 opacity-0",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    />
  )
}
