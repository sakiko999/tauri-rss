/**
 * @tauri-playground/player — 媒体播放器(video/audio/live 共用)。
 *
 * 从 @tauri-playground/ui 拆出的独立包。播放器 + MediaChrome 式独立控件。
 * 依赖 core 的 MediaStream 类型 + 全局 appHost 门面(hls/flv/dash 走隧道)。
 *
 * 依赖链:core ← player ← ui/desktop。
 */
export { PlayableMedia } from "./PlayableMedia.tsx"
export { unlockAudioPlayback } from "./PlayableMedia.tsx"
export { useMediaStream, isHlsStream, isFlvStream, isDashStream } from "./hooks/useMediaStream.ts"
export {
  useStreamSelection,
  isProgressiveVideo,
  isProgressiveAudio,
  isRtmp,
  isStreamingStream,
} from "./hooks/useStreamSelection.ts"
export { useVideoElement, bindFullscreen } from "./hooks/useVideoElement.ts"
export type { VideoPlayState, VideoOps, FullscreenApi, BufferedRange } from "./hooks/useVideoElement.ts"
export { VideoShell } from "./VideoShell.tsx"
export { DanmakuLayer } from "./danmaku/DanmakuLayer.tsx"
export { AudioShell } from "./AudioShell.tsx"
export { PlayerControls } from "./PlayerControls.tsx"
export type { MediaStream } from "@tauri-playground/core"
export type { DanmakuStream } from "@tauri-playground/crawler"

// ── MediaChrome 式独立控件(可自由组合)────────────────────────
export {
  MediaPlayButton,
  MediaMuteButton,
  MediaVolumeSlider,
  MediaTimeRange,
  MediaRateButton,
  MediaQualityButton,
  MediaFullscreenButton,
  MediaLiveEdgeButton,
  MediaTimeDisplay,
} from "./controls/index.ts"
