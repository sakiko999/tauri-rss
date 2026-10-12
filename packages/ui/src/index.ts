/**
 * @tauri-playground/ui — 共用原子件。
 *
 * ⚠️ 现在只剩两个消费者能用到的东西:MediaImage(防盗链图隧道)与 fmtCount。
 * renderers/ 下的 UnifiedCard / MediaItemView / 各 *Renderer 与 atoms 里的
 * MediaCard/CardThumb/Skeleton/UnreadDot/RelativeTime **已无消费者**
 * (desktop 改用自己的 components/cards.tsx),待清理。
 *
 * 播放器组件已拆到 @tauri-playground/player;下面的 re-export 只是给旧 import 兜底。
 */
export { MediaImage } from "./renderers/atoms/MediaImage.tsx"
export { fmtDuration, fmtAudioDuration, fmtCount } from "./renderers/atoms/format.ts"

// ── 播放组件(video/audio/live 共用)─────────────────────────────
// 新代码应直接引 @tauri-playground/player。
export {
  PlayableMedia,
  unlockAudioPlayback,
  useMediaStream,
  isHlsStream,
  isFlvStream,
  isDashStream,
  useStreamSelection,
  isProgressiveVideo,
  isProgressiveAudio,
  isRtmp,
  isStreamingStream,
  useVideoElement,
  bindFullscreen,
  VideoShell,
  AudioShell,
  PlayerControls,
} from "@tauri-playground/player"
export type {
  MediaStream,
  VideoPlayState,
  VideoOps,
  FullscreenApi,
  BufferedRange,
} from "@tauri-playground/player"
