/**
 * @tauri-playground/ui — desktop/mobile 通用 UI 组件库。
 *
 * 当前仅含媒体渲染器(按 kind 分发)+ 渲染器原子组件。播放器已拆到
 * @tauri-playground/player(见下 re-export,保持旧入口可用)。
 */
export { MediaItemView } from "./renderers/MediaItemView.tsx"
export { UnifiedCard } from "./renderers/UnifiedCard.tsx"
export { ArticleRenderer } from "./renderers/ArticleRenderer.tsx"
export { VideoRenderer } from "./renderers/VideoRenderer.tsx"
export { AudioRenderer } from "./renderers/AudioRenderer.tsx"
export { LiveRenderer } from "./renderers/LiveRenderer.tsx"
export { SocialRenderer } from "./renderers/SocialRenderer.tsx"
export type { RendererCallbacks } from "./renderers/types.ts"

// ── 渲染器原子组件(卡片壳 / 缩略图 / 图片 / 占位等)─────────────
export { MediaCard } from "./renderers/atoms/MediaCard.tsx"
export { CardThumb } from "./renderers/atoms/CardThumb.tsx"
export { MediaImage } from "./renderers/atoms/MediaImage.tsx"
export { Skeleton } from "./renderers/atoms/Skeleton.tsx"
export { UnreadDot } from "./renderers/atoms/UnreadDot.tsx"
export { RelativeTime } from "./renderers/atoms/RelativeTime.tsx"
export { fmtDuration, fmtAudioDuration, fmtCount } from "./renderers/atoms/format.ts"

// ── 播放组件(video/audio/live 共用)─────────────────────────────
// 已拆到 @tauri-playground/player。此处 re-export 兼容旧入口;新代码应直接引 player 包。
export {
  MediaPlayer,
  PlayableMedia,
  unlockAudioPlayback,
  useMediaStream,
  isHlsStream,
  isFlvStream,
  isDashStream,
  useVideoElement,
  bindFullscreen,
  VideoShell,
  PlayerControls,
} from "@tauri-playground/player"
export type {
  MediaStream,
  VideoPlayState,
  VideoOps,
  FullscreenApi,
  BufferedRange,
} from "@tauri-playground/player"
