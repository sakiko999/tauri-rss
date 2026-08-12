/**
 * MediaPlayer —— 通用媒体播放器(video/audio/live 共用)。
 *
 * 输入是懒解析出的 `MediaStream[]`(带 url/format/headers)。选流与分发:
 *   - mp4/webm → 原生 `<video>` src;
 *   - mp3/aac/ogg → 原生 `<audio>` src;
 *   - m3u8/hls → useMediaStream(hls.js / 移动端原生);
 *   - http-flv → useMediaStream(flv.js,MSE 播放 —— douyu 直播即此);
 *   - rtmp:// 协议 → 浏览器播不了,占位。
 *
 * 实测:douyu 的 getH5Play 返回 https 的 .flv 地址(HTTP-FLV,FLV 头合法),
 * flv.js 可播——只有真 `rtmp://` 才播不了。
 *
 * 注意:原生 <video>/<audio> 无法带自定义 header(如 bilibili 直链的 referer)。
 * 带 headers 的 mp4 原生播可能 403 —— 当前如实提示;hls.js 经 xhrSetup 可带。
 */
import * as R from "ramda"
import { useCallback, useEffect, useRef, useState } from "react"
import type { MediaStream } from "@tauri-playground/core"
import { isDashStream, isFlvStream, isHlsStream, useMediaStream } from "./useHls.ts"
import { attemptPlayWithMuteFallback } from "./attemptPlay.ts"
import { VideoShell } from "./VideoShell.tsx"

/** 渐进式视频(mp4/webm/ogg)→ 原生 <video>。 */
function isProgressiveVideo(stream: MediaStream): boolean {
  const f = stream.format?.toLowerCase()
  if (f === "mp4" || f === "webm" || f === "ogg") return true
  return /\.(mp4|webm|ogg)(\?|#|$)/i.test(stream.url)
}

/** 渐进式音频(mp3/aac/ogg)→ 原生 <audio>。 */
function isProgressiveAudio(stream: MediaStream): boolean {
  const f = stream.format?.toLowerCase()
  if (f === "mp3" || f === "aac") return true
  return /\.(mp3|aac|ogg)(\?|#|$)/i.test(stream.url)
}

/** 真 rtmp 协议(rtmp://),浏览器/ flv.js 都播不了。 */
function isRtmp(stream: MediaStream): boolean {
  return /^rtmp:\/\//i.test(stream.url)
}

export function MediaPlayer({
  streams,
  className,
  autoPlay = false,
  onError,
  fill = false,
}: {
  /** 懒解析出的可播流,按顺序取第一个可播的。 */
  streams: MediaStream[]
  className?: string
  autoPlay?: boolean
  onError?: (err: unknown) => void
  /** 填满父容器(父已定比例)——透传给 VideoShell,避免双撑首帧塌缩。 */
  fill?: boolean
}) {
  const [error, setError] = useState<unknown>(null)
  const [retryKey, setRetryKey] = useState(0)
  // 多档位直播(douyu 等):用户切档后的目标档流。null = 用默认选流逻辑。
  // 切档不重发请求——resolveLivePlay 已返回全档位,从 streams 里按 rate 换流即可
  // (签名带 expiry,会话内够用;过期由 PlayableMedia 重新 resolve)。
  const [activeStream, setActiveStream] = useState<MediaStream | null>(null)
  // streams 变化(重新 resolve / props 更新)时重置用户切档态。
  useEffect(() => setActiveStream(null), [streams])

  // 默认选流:渐进式优先(双端兼容),其次 hls/flv(流媒体)。
  const defaultStream =
    streams.find(isProgressiveVideo) ??
    streams.find(isProgressiveAudio) ??
    streams.find(isHlsStream) ??
    streams.find(isFlvStream) ??
    streams[0]
  const stream = activeStream ?? defaultStream

  // 档位列表:去重同 rate 的 quality 名(服务端返回顺序即档位序)。单流无 quality → 不显示切换。
  // filter 出带 rate/quality 的流 → uniqBy(rate) 去重 → 取 {rate, quality}(手写 reduce 去重消掉)。
  // R.pipe 内类型守卫收窄不传递(泛型流丢失),改用显式标注的分步。
  const qualityOptions = R.map(
    (s: MediaStream & { rate: number; quality: string }) => ({ rate: s.rate, quality: s.quality }),
    R.uniqBy(
      (s: MediaStream & { rate: number; quality: string }) => s.rate,
      R.filter(
        (s): s is MediaStream & { rate: number; quality: string } => s.rate !== undefined && !!s.quality,
        streams,
      ),
    ),
  )
  const showQualityBar = qualityOptions.length >= 2

  const switchQuality = useCallback((rate: number) => {
    const target = streams.find((s) => s.rate === rate)
    if (!target) return
    setError(null)
    // 换流:useMediaStream 的 effect 依赖 stream,变化自动销毁旧 hls/flv 实例重建。
    setActiveStream(target)
  }, [streams])

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const needsStreamPlayer = !!stream && (isHlsStream(stream) || isFlvStream(stream) || isDashStream(stream))

  // 诊断:打印最终选中的流(URL 域名/截断 + format + headers 键),排查清晰度/来源。
  useEffect(() => {
    if (!stream) return
    let host = ""
    try {
      host = new URL(stream.url, "https://x.invalid").hostname
    } catch {
      host = stream.url.slice(0, 60)
    }
    const path = stream.url.length > 100 ? `…${stream.url.slice(-60)}` : stream.url
    console.info("[media] 选择流:", host, "| format:", stream.format ?? "?", "| headers:", Object.keys(stream.headers ?? {}).join(",") || "-", "|", path)
  }, [stream])

  useMediaStream({
    stream: needsStreamPlayer ? stream : null,
    videoRef,
    autoPlay,
    // retryKey 变化强制 useMediaStream 重建播放实例(错误重试)。
    retryKey,
    onError: (e) => {
      setError(e)
      onError?.(e)
    },
  })

  // 原生 mp4 分支的自动播放:与 HLS 对齐,**等媒体可播(canplay)后**带声 play。
  // ⚠️ 不能 src 刚设就立即 play:此时媒体未加载,autoplay policy 判定不稳定,
  // 带声 play 易被拦 → 降级静音(实测 video 静音、live 有声即因此——live 走 HLS
  // 在 canplay 才 play,媒体已就绪)。canplay 时媒体已加载,带声 play 最可能放行。
  // 被拦降级静音(保底可播);StrictMode 双挂载:第一个 video 被移除,检查 isConnected。
  const isNativeStream = !!stream && !needsStreamPlayer
  useEffect(() => {
    if (!autoPlay || !isNativeStream) return
    const el = videoRef.current
    if (!el) return
    const attemptUnmuted = () => {
      if (!el.isConnected) return
      el.muted = false
      // 带声 play;被 policy 拦 → 静音重试(attemptPlay 内部)。AbortError 不降级。
      attemptPlayWithMuteFallback(el, () => el.play(), { autoPlay })
    }
    // 只等 canplay(媒体可播)再带声 play——**不要立即 play**:src 刚设媒体未
    // 加载,立即 play 易被判失败 → 降级静音(YouTube video 静音即因此)。
    el.addEventListener("canplay", attemptUnmuted, { once: true })
    return () => el.removeEventListener("canplay", attemptUnmuted)
  }, [autoPlay, isNativeStream, stream?.url])

  if (!stream) {
    return <div className="rounded border border-zinc-300 p-4 text-center text-sm text-zinc-500">无可播流</div>
  }

  if (error) {
    return (
      <div className="space-y-2 rounded border border-red-300 p-4 text-center text-sm text-red-600">
        <p>播放失败:{error instanceof Error ? error.message : String(error)}</p>
        <button
          type="button"
          onClick={() => {
            setError(null)
            setRetryKey((k) => k + 1)
          }}
          className="rounded border border-red-300 px-3 py-1 text-xs hover:bg-red-50"
        >
          重试
        </button>
      </div>
    )
  }

  // 真 rtmp 播不了。
  if (isRtmp(stream)) {
    return (
      <div className="rounded border border-zinc-300 p-4 text-center text-sm text-zinc-500">
        该流为 rtmp 协议,当前浏览器无法直接播放
      </div>
    )
  }

  // 媒体元素默认全宽 + 黑底。
  const mediaClass = ["w-full", "rounded", "bg-black", className].filter(Boolean).join(" ")
  // 带 referer 头的渐进式 mp4 原生播可能被 CDN 拒(浏览器无法带自定义 header)。
  // 作为 title 提示挂外壳,不进流式布局(避免与 video 并列占行)。
  const headerHintTitle = stream.headers ? "该直链可能需要 referer 头,若播放失败请用浏览器打开" : undefined

  // 多档位切换条(直播多清晰度,douyu 等)。当前档高亮,点击切档(已有全档位流,直接换)。
  const qualityBar = showQualityBar ? (
    <div className="flex flex-wrap gap-1">
      {qualityOptions.map(({ rate, quality }) => {
        const active = stream?.rate === rate
        return (
          <button
            key={rate}
            type="button"
            onClick={() => switchQuality(rate)}
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
  ) : null

  // 渐进式视频 / HLS / FLV / DASH → 统一用 VideoShell 外壳(自定义控件)。
  if (isProgressiveVideo(stream) || needsStreamPlayer) {
    return (
      <div className="space-y-1">
        <VideoShell
          videoRef={videoRef}
          isStreaming={needsStreamPlayer}
          src={isProgressiveVideo(stream) ? stream.url : undefined}
          autoPlay={autoPlay}
          qualityOptions={qualityOptions}
          activeQuality={stream.rate}
          onQuality={switchQuality}
          title={headerHintTitle}
          fill={fill}
        />
      </div>
    )
  }

  // 渐进式音频(mp3/aac)→ 原生 <audio>,保留浏览器控件(音频无画面,外壳不适用)。
  if (isProgressiveAudio(stream)) {
    return (
      <div className="space-y-1">
        {qualityBar}
        <audio
          src={stream.url}
          controls
          autoPlay={autoPlay}
          muted={autoPlay}
          preload="none"
          // audio 无画面:不要黑底(mediaClass 含 bg-black 是给 video 的)。
          className={["w-full", className].filter(Boolean).join(" ")}
        />
      </div>
    )
  }

  // 未知流类型:兜底原生 <video>。
  return (
    <div className="space-y-1">
      <video ref={videoRef} controls autoPlay={autoPlay} className={mediaClass} />
    </div>
  )
}
