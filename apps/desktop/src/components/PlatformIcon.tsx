/**
 * 平台品牌图标(各站 favicon,打包在 `public/brand`,不依赖外网)。
 *
 * 平台身份在 UI 里应当一眼可辨:统一搜索跨平台合并后,只靠文字平台名不够快。
 * 没有品牌资源的平台(RSS / RSSHub)回落到 lucide 图标。
 */

import { Icon } from "./Icon.tsx"

/** 平台 id(与 `@amoeba/platform` 的 PLATFORMS.id 一致)→ 品牌图标。 */
const BRAND_SRC: Record<string, string> = {
  bili: "/brand/bili.ico",
  youtube: "/brand/youtube.ico",
  twitch: "/brand/twitch.ico",
  douyu: "/brand/douyu.ico",
  huya: "/brand/huya.ico",
  douyin: "/brand/douyin.ico",
  weibo: "/brand/weibo.ico",
  xhs: "/brand/xhs.ico",
  apple: "/brand/apple.ico",
}

/** 无品牌图标时的兜底语义图标。 */
const FALLBACK_ICON: Record<string, string> = {
  rss: "rss",
  rsshub: "rss",
}

export function PlatformIcon({
  platform,
  size = 16,
  fallback,
  className,
  /** 图标单独承担平台含义时传(角标场景);旁边已有平台名时省略,避免读屏重复。 */
  label,
}: {
  platform: string | undefined
  size?: number
  /** 没有品牌图标时用哪个 lucide 图标(默认 rss / layers)。 */
  fallback?: string
  className?: string
  label?: string
}) {
  const src = platform ? BRAND_SRC[platform] : undefined
  if (!src) {
    return (
      <Icon
        name={fallback ?? (platform ? FALLBACK_ICON[platform] : undefined) ?? "layers"}
        size={size}
        className={className}
      />
    )
  }
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt={label ?? ""}
      aria-hidden={label ? undefined : "true"}
      title={label}
      draggable={false}
      className={`platform-icon${className ? ` ${className}` : ""}`}
    />
  )
}
