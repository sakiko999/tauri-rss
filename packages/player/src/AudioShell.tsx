/**
 * AudioShell —— 原生音频外壳(mp3/aac/ogg)。
 *
 * 与 VideoShell 对偶:audio 无画面,保留浏览器原生 `<audio controls>` 控件,
 * 不套自定义外壳(控件层 + 自动隐藏只对视频有意义)。壳负责:
 *   - 原生 <audio> + autoPlay(已解锁时带声起播,与视频分支对称);
 *   - 多档位切换条(直播多清晰度,douyu 等);
 *   - referer 头提示(带 headers 的原生直链可能 403,浏览器无法带自定义 header)。
 */
import { useEffect, useRef } from "react"
import { attemptPlayWithMuteFallback } from "./utils/attemptPlay.ts"
import { log } from "./log/index.ts"

export function AudioShell({
  src,
  autoPlay,
  onError,
  qualityOptions,
  activeQuality,
  onQuality,
  className,
}: {
  src: string
  autoPlay?: boolean
  /** 起播失败(policy 拦且降级也失败)时上报——对齐视频分支的 onError。 */
  onError?: (e: unknown) => void
  /** 多档位列表;length < 2 不显示。 */
  qualityOptions: { rate: number; quality: string }[]
  activeQuality?: number
  onQuality: (rate: number) => void
  className?: string
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  // onError 用 ref 持最新(与 useMediaStream 的 onErrorRef 同模式):父组件每次渲染
  // 传新函数,但起播 effect 不该因它重跑——否则 onError 变化会重建 canplay 监听,
  // 错过已派发的 canplay 事件导致起播丢失。
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  // 原生 audio 的自动播放:与视频分支对齐,等 canplay(媒体可播)后带声 play。
  // ⚠️ 不能 src 刚设就立即 play:此时媒体未加载,带声 play 易被拦 → 降级静音。
  // 被拦降级静音(保底可播);StrictMode 双挂载:第一个 audio 被移除,检查 isConnected。
  useEffect(() => {
    if (!autoPlay) return
    const el = audioRef.current
    if (!el) return
    const attemptUnmuted = () => {
      if (!el.isConnected) return
      el.muted = false
      attemptPlayWithMuteFallback(el, () => el.play(), { autoPlay, onFail: onErrorRef.current })
    }
    el.addEventListener("canplay", attemptUnmuted, { once: true })
    return () => el.removeEventListener("canplay", attemptUnmuted)
  }, [autoPlay, src])

  return (
    <div className="space-y-1">
      {qualityOptions.length >= 2 && (
        <div className="flex flex-wrap gap-1">
          {qualityOptions.map(({ rate, quality }) => {
            const active = activeQuality === rate
            return (
              <button
                key={rate}
                type="button"
                onClick={() => onQuality(rate)}
                className={[
                  "rounded px-2 py-0.5 text-xs",
                  active
                    ? "bg-blue-600 text-white"
                    : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100",
                ].join(" ")}
              >
                {quality}
              </button>
            )
          })}
        </div>
      )}
      <audio
        ref={audioRef}
        src={src}
        controls
        autoPlay={autoPlay}
        preload="none"
        // audio 加载失败(403/断流/格式不支持)→ 上报(起播 onFail 只管 play() reject,
        // 媒体加载失败 canplay 永不触发,只能靠 error 事件)。
        onError={() => {
          const el = audioRef.current
          log.mediaError({ code: el?.error?.code, msg: el?.error?.message ?? "" })
          onErrorRef.current?.(new Error(el?.error?.message ?? `audio error(code=${el?.error?.code ?? "?"})`))
        }}
        // audio 无画面:不要黑底(mediaClass 含 bg-black 是给 video 的)。
        className={["w-full", className].filter(Boolean).join(" ")}
      />
    </div>
  )
}
