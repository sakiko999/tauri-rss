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

/**
 * 弹幕流的**可序列化**描述。
 *
 * `ResolvePlayback.danmaku` 是函数(订阅即拉取),进程内直接可用;但桌面走数据服务,
 * 结果要过 RPC(JSON) —— **函数会被序列化丢掉**(2026-10-29 实测:resolvePlay 回来只剩
 * `streams`/`chapters`,视频弹幕自服务化起就没了)。服务端同时给这份 ref,客户端在
 * 本地经 `getDanmakuByUrl` 重建(seg.so/直播 ws 走客户端自己的 appHost 隧道)。
 */
export interface DanmakuRef {
  /** 条目 url（弹幕路由用，与解析同一个 url）。 */
  url: string
  /** vod（视频时间轴）/ live（实时聊天），与解析侧调用 getDanmakuByUrl 时一致。 */
  kind: "vod" | "live"
  // ⚠️ 不带 cookie：凭证只在服务进程里（协议没有「读凭证」的 RPC，也不该为重建弹幕
  // 开这个口子）。B 站视频/直播、斗鱼、虎牙的弹幕匿名可用；抖音直播弹幕（要 ttwid）
  // 在桌面暂缺 —— 要恢复得走「服务端订阅 + 推送」，不是把 cookie 递给客户端。
}

export interface ResolvePlayback {
  streams: MediaStream[]
  /** source 具备 DanmakuPlayable 时附带(getDanmaku 已探好);否则 undefined。
   *  ⚠️ 函数过 RPC 会丢 —— 远端消费方改看 `danmakuRef` 并本地重建。 */
  danmaku?: DanmakuStream
  /** danmaku 的序列化形态（见 DanmakuRef）。 */
  danmakuRef?: DanmakuRef
  /** 有的平台才给（播客 RSS、YouTube 都没有）；空/undefined = 没有章节。 */
  chapters?: PlaybackChapter[]
}
