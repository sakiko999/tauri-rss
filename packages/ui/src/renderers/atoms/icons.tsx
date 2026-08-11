/**
 * 渲染器内联 SVG 图标(随 ui 包自包含,不依赖图标库)。
 * 与 player/icons.tsx 同范式:viewBox="0 0 24 24" + currentColor,调用方设色。
 */
import type { SVGProps } from "react"

/** 图片加载失败占位图标(图片 403 等)。 */
export function ImageOffIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M2 2l20 20" />
      <path d="M10.41 10.41a2 2 0 1 1-2.83-2.83" />
      <path d="M13.5 13.5L8 19M9.5 6H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2" />
    </svg>
  )
}
