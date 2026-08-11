/**
 * Live platform identifiers — owned by core (the render model layer).
 * String-literal union; crawler 直播 channel 产出的 `tpl:platform` 与之对齐。
 */
export type LivePlatformId = "bilibili" | "douyu" | "huya" | "douyin" | "youtube"
export type LiveStatus = "live" | "offline" | "unknown"
