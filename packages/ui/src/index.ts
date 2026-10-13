/**
 * @tauri-playground/ui — 共用原子件。
 *
 * ⚠️ 现在只剩两个消费者能用到的东西:MediaImage(防盗链图隧道)与 fmtCount。
 * renderers/ 下的 UnifiedCard / MediaItemView / 各 *Renderer 与 atoms 里的
 * MediaCard/CardThumb/Skeleton/UnreadDot/RelativeTime **已无消费者**
 * (desktop 改用自己的 components/cards.tsx),待清理。
 *
 * 播放组件已拆到 @tauri-playground/player,**直接引 player**(此前的 re-export 兜底
 * 全仓零消费者,已删)。
 */
export { MediaImage } from "./renderers/atoms/MediaImage.tsx"
export { fmtCount } from "./renderers/atoms/format.ts"
