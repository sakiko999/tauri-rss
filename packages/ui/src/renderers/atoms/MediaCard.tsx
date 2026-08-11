/**
 * MediaCard — 媒体卡片统一壳(参考 Folo grid/list 卡片容器)。
 *
 * 素色:border-border + bg-card + hover 微灰,明暗自适配(语义令牌)。
 * 整卡可点:onClick 绑 onOpen;内部交互按钮需自行 stopPropagation。
 * `h-full`(flex-col)由调用方决定——网格行内等高卡片传,列表行式不传。
 */
import type { ReactNode } from "react"

export function MediaCard({
  onOpen,
  className,
  children,
}: {
  onOpen?: () => void
  className?: string
  children: ReactNode
}) {
  return (
    <article
      onClick={onOpen}
      className={[
        "group flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-colors",
        onOpen ? "cursor-pointer hover:bg-muted/50" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </article>
  )
}
