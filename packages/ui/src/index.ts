/**
 * @tauri-playground/ui — desktop/mobile 通用 UI 组件库。
 *
 * 当前仅含媒体渲染器(按 kind 分发)。后续 P2/P3 的 reader/masonry/shortvideo
 * 组件树在此扩展(见 docs/technical-plan.md)。
 */
export { MediaItemView } from "./renderers/MediaItemView.tsx"
export { ArticleRenderer } from "./renderers/ArticleRenderer.tsx"
export { VideoRenderer } from "./renderers/VideoRenderer.tsx"
export { AudioRenderer } from "./renderers/AudioRenderer.tsx"
export { LiveRenderer } from "./renderers/LiveRenderer.tsx"
export { SocialRenderer } from "./renderers/SocialRenderer.tsx"
export type { RendererCallbacks } from "./renderers/types.ts"

// ── 播放组件(video/audio/live 共用)─────────────────────────────
export { MediaPlayer } from "./player/MediaPlayer.tsx"
export { PlayableMedia } from "./player/PlayableMedia.tsx"
export { unlockAudioPlayback } from "./player/PlayableMedia.tsx"
export { useMediaStream } from "./player/useHls.ts"
export type { MediaStream } from "@tauri-playground/core"
