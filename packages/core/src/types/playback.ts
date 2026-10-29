/**
 * 懒解析结果 —— 播放流 + 弹幕能力(一次性给齐)。
 *
 * resolvePlay/resolveLivePlay 的返回契约:source 具备 DanmakuPlayable 能力时
 * 附带 `danmaku`(source.getDanmaku 已探好),上层无需再单独调 openDanmaku。
 */

import type { DanmakuStream } from "@amoeba/resolve"

import type { MediaStream } from "./media-item.ts"

/** 平台给的章节时间点（秒 + 标题）。目前只有 bili 有（UP 主标的 view_points）。 */
export interface PlaybackChapter {
  t: number
  label: string
}

export interface ResolvePlayback {
  streams: MediaStream[]
  /** source 具备 DanmakuPlayable 时附带(getDanmaku 已探好);否则 undefined。 */
  danmaku?: DanmakuStream
  /** 有的平台才给（播客 RSS、YouTube 都没有）；空/undefined = 没有章节。 */
  chapters?: PlaybackChapter[]
}
