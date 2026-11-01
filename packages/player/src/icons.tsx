/**
 * 播放器内联 SVG 图标(随 UI 包自包含,不依赖图标库)。
 * 统一 `viewBox="0 0 24 24"` + `fill/stroke=currentColor`,由调用方设色。
 */

import type { SVGProps } from "react"

/**
 * 图标统一口径(对齐 B 站控件字形实测 17-18px,B 站 svg 渲染框 22px):
 * 所有 glyph 在 24 viewBox 内占 ~18-19 单位,按 22px 渲染 ≈ 17px;
 * 播放三角 ~14×18、暂停双条 ~18 高、喇叭 ~18 高,避免「三角明显比喇叭小」。
 */
export function PlayIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
      <path d="M6 2.9v18.2L19.8 12 6 2.9z" />
    </svg>
  )
}

export function PauseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
      <rect x="5.5" y="2.6" width="5" height="18.8" rx="1" />
      <rect x="13.5" y="2.6" width="5" height="18.8" rx="1" />
    </svg>
  )
}

export function VolumeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
      <path d="M3 8.5v7h4l5.5 5.5V3L7.5 8.5H3z" />
      <path d="M16 8.2a5.5 5.5 0 0 1 0 7.6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M18.8 5.4a9.5 9.5 0 0 1 0 13.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function VolumeMutedIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
      <path d="M3 8.5v7h4l5.5 5.5V3L7.5 8.5H3z" />
      <path d="M16 9l6 6M22 9l-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export function FullscreenIcon(props: SVGProps<SVGSVGElement>) {
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
      <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  )
}

export function FullscreenExitIcon(props: SVGProps<SVGSVGElement>) {
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
      <path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" />
    </svg>
  )
}

/** 后退:圆环 + 逆时针箭头（秒数由调用方叠在下方）。 */
export function RewindIcon(props: SVGProps<SVGSVGElement>) {
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
      <path d="M3.6 9.6A9 9 0 1 1 12 21" />
      <path d="M3 4.6v5h5" />
    </svg>
  )
}

/** 前进:圆环 + 顺时针箭头（秒数由调用方叠在下方）。 */
export function ForwardIcon(props: SVGProps<SVGSVGElement>) {
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
      <path d="M20.4 9.6A9 9 0 1 0 12 21" />
      <path d="M21 4.6v5h-5" />
    </svg>
  )
}

/** 缓冲 spinner:单弧线 + 缺口,配合 `animate-spin` 旋转。 */
export function SpinnerIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

/** 宽屏(剧场):圆角框内左右箭头 —— B 站「宽屏模式」按钮同形。 */
export function TheaterIcon(props: SVGProps<SVGSVGElement>) {
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
      <rect x="2" y="4.5" width="20" height="15" rx="2.5" />
      <path d="M10 8.5 7 12l3 3.5M14 8.5l3 3.5-3 3.5" />
    </svg>
  )
}
