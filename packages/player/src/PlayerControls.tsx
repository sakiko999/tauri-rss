/**
 * PlayerControls —— 控件栏(B 站网页端播放器布局的 React 版)。
 *
 * 视觉以 **2026-11 实抓的 B 站播放页** 为准(computed style,非凭印象):
 *   - 控件行高 **35px**、左右 **12px** 内边距;图标命中区 **36×22**、图标白 80%
 *     (hover 纯白),文字按钮 **14px** 无底色;整行**没有分隔线**;
 *   - 进度条 4px 恒定、已播 **#00AEEC**(B 站蓝)、缓冲白 30%、轨道白 20%;
 *   - 点播右侧顺序:清晰度(文本) → 倍速(文本,恒为「倍速」)→ 音量 → 弹幕开关
 *     → 宽屏 → 全屏;左侧:播放 → `01:00 / 02:10`(补零);
 *   - 直播(B 站直播播放器同款分流):左侧 播放 → 回直播(滞后时) → 音量 → 已播
 *     `407:26:23`(补零 hh:mm:ss),右侧 清晰度 → 弹幕开关 → 宽屏 → 全屏;
 *     无倍速/无时长/**无进度条**(缓冲段一直伸缩观感很怪,用户明确要求隐藏)。
 *   - 弹幕开关 = 「弹」框 + 开启时品牌粉对勾(对齐 B 站直播控件行);
 *     **没有弹幕输入/发送**(B 站的发送条在视频下方页面里,本项目不提供写操作)。
 *
 * 纯受控:状态来自 `VideoPlayState`,操作来自 `VideoOps`;浮层菜单挂 `container`
 * (全屏/小窗时必须传,否则菜单 Portal 到 body 全屏外不可见)。
 * ⚠️ 本组件不自带圆角 —— 方角,由外部消费者决定圆角与裁切。
 */

import {
  MediaDanmakuButton,
  MediaFullscreenButton,
  MediaLiveEdgeButton,
  MediaPlayButton,
  MediaQualityButton,
  MediaRateButton,
  MediaTimeDisplay,
  MediaTimeRange,
  MediaVolumeSlider,
} from "./controls/index.ts"
import type { DanmakuControl } from "./controls/index.ts"
import type { MediaClock } from "./hooks/mediaClock.ts"
import type { FullscreenApi, VideoOps, VideoPlayState } from "./hooks/useVideoElement.ts"
import { TheaterIconButton } from "./theater.tsx"

export type PlayerMode = "video" | "live"

/** 图标按钮命中区 36×22(B 站实测)。 */
const ICON_BTN = "flex h-[22px] w-9 shrink-0 items-center justify-center text-white/80 hover:text-white"

export function PlayerControls({
  state,
  ops,
  clock,
  fullscreen,
  qualityOptions,
  activeQuality,
  onQuality,
  danmakuControl,
  mode,
  theater,
  container,
}: {
  state: VideoPlayState
  ops: VideoOps
  /** 播放时钟(热字段外部 store):进度/时间控件各自按值订阅。 */
  clock: MediaClock
  fullscreen: FullscreenApi
  /** 多档位列表(rate + quality);长度 < 2 时档位按钮不渲染。 */
  qualityOptions: { rate: number; quality: string }[]
  activeQuality?: number
  onQuality: (rate: number) => void
  /** 弹幕开关;无弹幕流时不传,按钮不渲染。 */
  danmakuControl?: DanmakuControl
  /** 直播/点播模式(显式声明;宿主知道条目 kind,比等媒体元数据可靠)。 */
  mode?: PlayerMode
  /** 宽屏(剧场)开关;宿主不提供时不渲染按钮。 */
  theater?: { on: boolean; toggle: () => void }
  /** 浮层菜单挂载点(全屏/小窗容器);不传 = document.body(全屏内不可见)。 */
  container?: HTMLElement | null
}) {
  const live = mode === "live" || (mode === undefined && state.live)
  return (
    <div className="flex flex-col bg-linear-to-t from-black/80 via-black/40 to-transparent pt-2 pb-0.5 text-white">
      {/* 进度行:仅点播。直播没有固定时长,缓冲条会一直伸缩(观感很怪),
          按用户要求隐藏 —— 只保留「回直播」入口(滞后于直播边缘时出现)。 */}
      {live ? null : (
        <div className="flex items-center gap-3 px-3">
          <MediaTimeRange state={state} ops={ops} clock={clock} />
        </div>
      )}

      {/* 控件行:35px / 12px 边距 / 无分隔线(B 站实测) */}
      <div className="flex h-[35px] items-center px-3 text-[14px]">
        <MediaPlayButton state={state} ops={ops} className={ICON_BTN} />
        {live ? (
          <>
            {/* 直播:B 站把音量放在左侧,时间 = 已播 hh:mm:ss */}
            <MediaLiveEdgeButton state={state} ops={ops} clock={clock} />
            <MediaVolumeSlider state={state} ops={ops} />
            <MediaTimeDisplay state={state} clock={clock} mode="live" />
          </>
        ) : (
          <MediaTimeDisplay state={state} clock={clock} mode="video" />
        )}

        <div className="flex-1" />

        <MediaQualityButton
          qualityOptions={qualityOptions}
          activeQuality={activeQuality}
          onQuality={onQuality}
          container={container}
        />
        {live ? null : <MediaRateButton state={state} ops={ops} container={container} />}
        {live ? null : <MediaVolumeSlider state={state} ops={ops} />}
        <MediaDanmakuButton control={danmakuControl} />
        <TheaterIconButton theater={theater} />
        <MediaFullscreenButton fullscreen={fullscreen} className={ICON_BTN} />
      </div>
    </div>
  )
}
