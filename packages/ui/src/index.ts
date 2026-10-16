/**
 * @amoeba/ui — 共用原子件。
 *
 * ⚠️ 现在只剩两个对外导出:MediaImage(防盗链图隧道)与 fmtCount。
 * renderers/ 下的 UnifiedCard / MediaItemView / 各 *Renderer 已删(desktop 改用自己的
 * components/app/Cards.tsx)。atoms 里的 Skeleton / Icons.tsx 仍在——被同包 MediaImage 内部
 * 使用(加载占位 + 破图图标),非对外 API。
 *
 * 播放组件已拆到 @amoeba/player,**直接引 player**(此前的 re-export 兜底
 * 全仓零消费者,已删)。
 */
export { MediaImage } from "./renderers/atoms/MediaImage.tsx"
export { fmtCount } from "./renderers/atoms/format.ts"
