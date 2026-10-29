/**
 * 懒解析结果 —— 播放流 + 弹幕能力(一次性给齐)。
 *
 * resolvePlay/resolveLivePlay 的返回契约:source 具备 DanmakuPlayable 能力时
 * 附带 `danmaku`(source.getDanmaku 已探好),上层无需再单独调 openDanmaku。
 */

import type { DanmakuItem, DanmakuStream } from "@amoeba/resolve"

import type { MediaStream } from "./media-item.ts"

/** 弹幕批次里的单条（协议 `danmaku.items` 事件要过 JSON，故在此透出给 service-protocol）。 */
export type { DanmakuItem, DanmakuStream }

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
 * `streams`/`chapters`,视频弹幕自服务化起就没了)。服务端同时给这份 ref。
 *
 * 桌面**不再**用它本地重建(匿名重建会丢掉平台凭证):弹幕统一走服务端订阅 + 推送
 * (`danmaku.open` RPC → `danmaku.items` 事件,见 `DataLayer.resolveDanmaku`)。
 * ref 保留作能力标记(「这个条目有弹幕」)与 CLI 探针的可序列化返回。
 */
export interface DanmakuRef {
  /** 条目 url（弹幕路由用，与解析同一个 url）。 */
  url: string
  /** vod（视频时间轴）/ live（实时聊天），与解析侧调用 getDanmakuByUrl 时一致。 */
  kind: "vod" | "live"
  // ⚠️ 不带 cookie：凭证只在服务进程里（协议没有「读凭证」的 RPC）。弹幕连接也开在
  // 服务进程内（需要 cookie 的抖音直播弹幕因此可用），客户端只收已解析的条目。
}

export interface ResolvePlayback {
  streams: MediaStream[]
  /** source 具备 DanmakuPlayable 时附带(getDanmaku 已探好);否则 undefined。
   *  ⚠️ 函数过 RPC 会丢 —— 远端消费方改调 `resolveDanmaku(subscriptionId, url, kind)`。 */
  danmaku?: DanmakuStream
  /** danmaku 的序列化形态（见 DanmakuRef）。 */
  danmakuRef?: DanmakuRef
  /** 有的平台才给（播客 RSS、YouTube 都没有）；空/undefined = 没有章节。 */
  chapters?: PlaybackChapter[]
}
