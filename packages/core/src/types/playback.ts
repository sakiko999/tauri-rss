/**
 * 懒解析结果 —— 播放流 + 弹幕能力(一次性给齐)。
 *
 * resolvePlay/resolveLivePlay 的返回契约:source 具备 DanmakuPlayable 能力时
 * 附带 `danmaku`(source.getDanmaku 已探好),上层无需再单独调 openDanmaku。
 */
import type { DanmakuStream } from "@tauri-playground/crawler"
import type { MediaStream } from "./media-item.ts"

export interface ResolvePlayback {
  streams: MediaStream[]
  /** source 具备 DanmakuPlayable 时附带(getDanmaku 已探好);否则 undefined。 */
  danmaku?: DanmakuStream
}
