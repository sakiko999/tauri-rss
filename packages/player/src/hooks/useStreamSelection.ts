/**
 * useStreamSelection —— 选流 + 档位切换。
 *
 * 输入懒解析出的 MediaStream[]（带 url/format/headers），输出：
 *   - stream:当前应播放的流（默认选流 或 用户切档后的目标流）；
 *   - qualityOptions:多档位列表（rate + quality，去重同 rate），< 2 档不显示切换；
 *   - switchQuality:切档（已有全档位流，直接换，不重发 resolve）。
 *
 * 选流策略:渐进式优先(双端兼容),其次 hls/flv(流媒体)。切档态在 streams
 * 变化(重新 resolve / props 更新)时自动重置。
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import type { MediaStream } from "@tauri-playground/core"
import { isFlvStream, isHlsStream } from "./useMediaStream.ts"
import { log } from "../log/index.ts"

/** 渐进式视频(mp4/webm/ogg)→ 原生 <video>。 */
export function isProgressiveVideo(stream: MediaStream): boolean {
  const f = stream.format?.toLowerCase()
  if (f === "mp4" || f === "webm" || f === "ogg") return true
  return /\.(mp4|webm|ogg)(\?|#|$)/i.test(stream.url)
}

/** 渐进式音频(mp3/aac/ogg)→ 原生 <audio>。 */
export function isProgressiveAudio(stream: MediaStream): boolean {
  const f = stream.format?.toLowerCase()
  if (f === "mp3" || f === "aac") return true
  return /\.(mp3|aac|ogg)(\?|#|$)/i.test(stream.url)
}

/** 真 rtmp 协议(rtmp://),浏览器 / flv.js 都播不了。 */
export function isRtmp(stream: MediaStream): boolean {
  return /^rtmp:\/\//i.test(stream.url)
}

/** 流媒体驱动(hls/flv/dash)→ useMediaStream 接管,非原生 src。 */
export function isStreamingStream(stream: MediaStream): boolean {
  return isHlsStream(stream) || isFlvStream(stream) || stream.format === "dash"
}

export function useStreamSelection(streams: MediaStream[]): {
  /** 当前应播放的流(默认选流或用户切档后的目标)。 */
  stream: MediaStream | undefined
  /** 多档位列表;length < 2 时 UI 不显示切换。 */
  qualityOptions: { rate: number; quality: string }[]
  /** 切档到指定 rate(streams 中无该档则忽略)。 */
  switchQuality: (rate: number) => void
} {
  // 多档位直播(douyu 等):用户切档后的目标档流。null = 用默认选流逻辑。
  // 切档不重发请求——resolve 已返回全档位,从 streams 里按 rate 换流即可
  // (签名带 expiry,会话内够用;过期由 PlayableMedia 重新 resolve)。
  const [activeStream, setActiveStream] = useState<MediaStream | null>(null)
  // streams 变化(重新 resolve / props 更新)时重置用户切档态。
  useEffect(() => setActiveStream(null), [streams])

  // 默认选流:渐进式优先(浏览器原生可播、无需额外引擎——最稳),
  // 其次 hls/flv(流媒体,依赖 hls.js/flv.js 引擎兜底)。
  // 取该格式族**第一个**——crawler 契约保证:返回数组内最高清晰度排最前
  // (各 channel 产流处显式按 rate 降序)。player 不做二次排序,保持简单。
  const defaultStream =
    streams.find(isProgressiveVideo) ??
    streams.find(isProgressiveAudio) ??
    streams.find(isHlsStream) ??
    streams.find(isFlvStream) ??
    streams[0]

  const stream = activeStream ?? defaultStream

  // 档位列表:去重同 rate 的 quality 名(服务端返回顺序即档位序)。单流无 quality → 不显示切换。
  // filter 出带 rate/quality 的流(type guard 直接收窄)→ 按 rate 去重 → 取 {rate, quality}。
  // 原生 filter/map:类型守卫在链中自然传递,比 R.pipe 内泛型丢失要绕行的写法更短。
  const qualityOptions = useMemo(() => {
    const withQuality = streams.filter(
      (s): s is MediaStream & { rate: number; quality: string } => s.rate !== undefined && !!s.quality,
    )
    const byRate = new Map<number, MediaStream & { rate: number; quality: string }>()
    for (const s of withQuality) {
      if (!byRate.has(s.rate)) byRate.set(s.rate, s)
    }
    return [...byRate.values()].map((s) => ({ rate: s.rate, quality: s.quality }))
  }, [streams])

  const switchQuality = useCallback(
    (rate: number) => {
      const target = streams.find((s) => s.rate === rate)
      if (!target) return
      log.qualitySwitched({ stream: target })
      // 换流:useMediaStream 的 effect 依赖 stream,变化自动销毁旧 hls/flv 实例重建。
      setActiveStream(target)
    },
    [streams],
  )

  return { stream, qualityOptions, switchQuality }
}
