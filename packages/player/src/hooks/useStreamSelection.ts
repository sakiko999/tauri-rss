/**
 * useStreamSelection —— 选流 + 档位切换。
 *
 * 输入懒解析出的 MediaStream[]（带 url/format/headers），输出：
 *   - stream:当前应播放的流（默认选流 或 用户切档后的目标流）；
 *   - qualityOptions:多档位列表（rate + quality，去重同 rate），< 2 档不显示切换；
 *   - switchQuality:切档（已有全档位流，直接换，不重发 resolve）。
 *
 * 选流策略:**取 `streams[0]`**(crawler 契约保证最高清晰度排最前)。
 * 切档态在 streams 变化(重新 resolve / props 更新)时自动重置。
 */

import type { MediaStream } from "@amoeba/core"
import { useCallback, useEffect, useMemo, useState } from "react"

// ⚠️ 判据统一放 `streamKind.ts`(纯函数、不 import 引擎),本模块与自检共用一份。
// 曾经这里与 useMediaStream 各写一遍(实现已经开始漂移)。
export { isProgressiveAudio, isProgressiveVideo, isRtmp, isStreamingStream } from "./streamKind.ts"
import { pickDefaultStream } from "./streamKind.ts"

/**
 * 默认选流 —— **取 `streams[0]`**。
 *
 * crawler 契约:`getSource().fetch` / 各平台 play 返回的数组**最高清晰度排最前**
 * (bili/youtube/douyin/huya 显式按 rate 降序;douyu 保留服务端 multirates 顺序
 * —— 它的 rate 是档位 ID 不是清晰度)。player 因此**不做二次排序**,取首档即可。
 *
 * ⚠️ 曾经按**格式族**挑(`find(isProgressiveVideo) ?? find(hls) ?? find(flv) ?? [0]`),
 * 以为「原生可播的最稳」。那会在首档不是渐进式、后面却有的时候**静默降画质**:
 * 实测 bili 的 DASH 档后面若跟一条 360p mp4,`find(isProgressiveVideo)` 就会跳过
 * 首档 1080p 的 dash 去取 360p;huya/douyu 出现混排时同理。
 * 契约既然保证了顺序,就不该再用格式族二次挑拣。
 */
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
  // streams **内容**变化时重置切档态。⚠️ 不能按引用(依赖数组 [streams]):props 流
  // 路径的调用方每次渲染都新建 `[item.stream]`,引用恒变 → effect 每渲染都跑 →
  // switchQuality 刚设的 activeStream 被立刻清空回退默认档(切档失效)。
  // 用 url+dashManifest 拼的签名当依赖,内容不变则不重置。
  const streamSig = streams.map((s) => `${s.url}|${s.dashManifest ?? ""}|${s.rate ?? ""}`).join("\n")
  useEffect(() => setActiveStream(null), [streamSig])

  const stream = activeStream ?? pickDefaultStream(streams)

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
      // 换流:useMediaStream 的 effect 依赖 stream,变化自动销毁旧 hls/flv 实例重建。
      setActiveStream(target)
    },
    [streams],
  )

  return { stream, qualityOptions, switchQuality }
}
