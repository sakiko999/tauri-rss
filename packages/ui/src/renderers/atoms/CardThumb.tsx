/**
 * CardThumb — 卡片缩略图容器(图片 + 角标)。
 *
 * aspect-ratio 撑开高度防跳动(加载前显示 Skeleton),badge 承载
 * 时长/直播状态等角标(absolute 定位)。无 src 时也撑开比例(占位)。
 */
import type { ReactNode } from "react"
import { MediaImage } from "./MediaImage.tsx"

export type ThumbRatio = "video" | "square" | "wide" | number

/** 预设宽高比:video 16:9、square 1:1、wide 21:9。传 number 自定义。 */
export function normalizeRatio(ratio: ThumbRatio): number {
  if (ratio === "video") return 16 / 9
  if (ratio === "square") return 1
  if (ratio === "wide") return 21 / 9
  return ratio
}

export function CardThumb({
  src,
  alt = "",
  ratio = "video",
  badge,
  badgeClassName,
  className,
  imgClassName,
}: {
  src?: string
  alt?: string
  ratio?: ThumbRatio
  /** 角标内容(时长/直播状态)。absolute 右上/右下由调用方通过 badgeClassName 控制。 */
  badge?: ReactNode
  badgeClassName?: string
  className?: string
  imgClassName?: string
}) {
  return (
    <div className={`relative shrink-0 ${className ?? ""}`}>
      <MediaImage src={src} alt={alt} ratio={normalizeRatio(ratio)} imgClassName={imgClassName} />
      {badge != null && (
        <div className={`pointer-events-none absolute ${badgeClassName ?? "bottom-2 right-2"}`}>
          {badge}
        </div>
      )}
    </div>
  )
}
