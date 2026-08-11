/**
 * 播放器控件集 —— MediaChrome 式「一个控件一个独立组件」。
 *
 * 每个控件窄接口、可自由组合:
 *   - `MediaPlayButton` / `MediaMuteButton` / `MediaFullscreenButton` / `MediaLiveEdgeButton`
 *   - `MediaTimeRange`(进度条,含缓冲/悬停/拖拽)
 *   - `MediaVolumeSlider`(悬停浮层音量)
 *   - `MediaRateButton`(倍速菜单,radix)/ `MediaQualityButton`(档位菜单,radix)
 *   - `MediaTimeDisplay`(时间 / ●LIVE)
 *
 * 组合范式(等价 MediaChrome `<media-control-bar>`):
 *   <PlayerControls state ops fullscreen qualityOptions activeQuality onQuality />
 *   或自行拼:
 *   <MediaPlayButton state ops /> <MediaTimeDisplay state />
 *   <MediaTimeRange state ops /> <MediaVolumeSlider state ops />
 *   <MediaRateButton state ops /> <MediaFullscreenButton fullscreen />
 */
export { MediaPlayButton } from "./MediaPlayButton.tsx"
export { MediaMuteButton } from "./MediaMuteButton.tsx"
export { MediaFullscreenButton } from "./MediaFullscreenButton.tsx"
export { MediaLiveEdgeButton, LIVE_EDGE_THRESHOLD_S } from "./MediaLiveEdgeButton.tsx"
export { MediaTimeRange } from "./MediaTimeRange.tsx"
export { MediaVolumeSlider } from "./MediaVolumeSlider.tsx"
export { MediaRateButton, PLAYBACK_RATES } from "./MediaRateButton.tsx"
export { MediaQualityButton } from "./MediaQualityButton.tsx"
export { MediaTimeDisplay } from "./MediaTimeDisplay.tsx"
