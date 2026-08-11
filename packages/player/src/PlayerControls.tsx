/**
 * PlayerControls —— 控件栏(默认组合,MediaChrome `<media-control-bar>` 的 React 版)。
 *
 * 现在只是把 controls/ 下的独立控件拼起来(等价 MediaChrome 声明式组合):
 *   播放/暂停 · 时间 · Seek · 音量 · 倍速 · 档位 · 全屏 · LIVE
 * 若要自定义布局,直接 import controls/ 各组件自行拼(见 controls/index.ts 顶部说明)。
 *
 * 纯受控:全部状态来自 `VideoPlayState`,操作来自 `VideoOps`。
 * 挂载在 VideoShell 底部,随自动隐藏一起显隐。
 */
import type { VideoOps, VideoPlayState, FullscreenApi } from "./useVideoElement.ts"
import {
  MediaFullscreenButton,
  MediaLiveEdgeButton,
  MediaPlayButton,
  MediaQualityButton,
  MediaRateButton,
  MediaTimeDisplay,
  MediaTimeRange,
  MediaVolumeSlider,
} from "./controls/index.ts"

export function PlayerControls({
  state,
  ops,
  fullscreen,
  qualityOptions,
  activeQuality,
  onQuality,
}: {
  state: VideoPlayState
  ops: VideoOps
  fullscreen: FullscreenApi
  /** 多档位列表(rate + quality);长度 < 2 时档位按钮不渲染。 */
  qualityOptions: { rate: number; quality: string }[]
  activeQuality?: number
  onQuality: (rate: number) => void
}) {
  return (
    <div className="flex flex-col gap-1 rounded-b-lg bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-4 text-white">
      {/* Seek(直播只显示缓冲状态,不可拖拽;带「回直播」按钮) */}
      <div className="flex items-center gap-2">
        <MediaLiveEdgeButton state={state} ops={ops} />
        <MediaTimeRange state={state} ops={ops} />
      </div>

      <div className="flex items-center gap-1 text-sm">
        <MediaPlayButton state={state} ops={ops} />
        <MediaTimeDisplay state={state} />

        <div className="flex-1" />

        <MediaVolumeSlider state={state} ops={ops} />
        <MediaRateButton state={state} ops={ops} />
        <MediaQualityButton
          qualityOptions={qualityOptions}
          activeQuality={activeQuality}
          onQuality={onQuality}
        />
        <MediaFullscreenButton fullscreen={fullscreen} />
      </div>
    </div>
  )
}
