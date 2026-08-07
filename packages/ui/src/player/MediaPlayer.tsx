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
import { useEffect, useRef, useState } from "react"
import type { MediaStream } from "@tauri-playground/core"
import { isDashStream, isFlvStream, isHlsStream, useMediaStream } from "./useHls.ts"

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
}: {
  /** 懒解析出的可播流,按顺序取第一个可播的。 */
  streams: MediaStream[]
  className?: string
  autoPlay?: boolean
  onError?: (err: unknown) => void
}) {
  const [error, setError] = useState<unknown>(null)
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
  const qualityOptions = streams
    .filter((s): s is MediaStream & { rate: number; quality: string } => s.rate !== undefined && !!s.quality)
    .reduce<Array<{ rate: number; quality: string }>>((acc, s) => {
      if (!acc.some((q) => q.rate === s.rate)) acc.push({ rate: s.rate, quality: s.quality })
      return acc
    }, [])
  const showQualityBar = qualityOptions.length >= 2

  function switchQuality(rate: number) {
    const target = streams.find((s) => s.rate === rate)
    if (!target) return
    setError(null)
    // 换流:useMediaStream 的 effect 依赖 stream,变化自动销毁旧 hls/flv 实例重建。
    setActiveStream(target)
  }

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
    onError: (e) => {
      setError(e)
      onError?.(e)
    },
  })

  // 原生 mp4 分支的自动播放:先带声 play()(用户已点「播放」+ unlockAudioPlayback
  // 已解锁),被 autoplay policy 拦则降级静音重试。
  // 注意 StrictMode 双挂载:第一个 video 会被移除,play() reject——检查 isConnected。
  const isNativeStream = !!stream && !needsStreamPlayer
  useEffect(() => {
    if (!autoPlay || !isNativeStream) return
    const el = videoRef.current
    if (!el) return
    el.muted = false
    const p = el.play() as Promise<void> | void
    if (p && typeof p.catch === "function") {
      p.catch(() => {
        if (!el.isConnected) return
        el.muted = true
        const retry = el.play() as Promise<void> | void
        if (retry && typeof retry.catch === "function") retry.catch(() => {})
      })
    }
  }, [autoPlay, isNativeStream, stream?.url])

  if (!stream) {
    return <div className="rounded border border-zinc-300 p-4 text-center text-sm text-zinc-500">无可播流</div>
  }

  if (error) {
    return (
      <div className="rounded border border-red-300 p-4 text-center text-sm text-red-600">
        播放失败:{error instanceof Error ? error.message : String(error)}
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

  // 原生 <video> 带 headers 时提示可能需 referer。
  const headerHint = stream.headers ? (
    <p className="text-xs text-zinc-400">该直链可能需要 referer 头,若播放失败请用浏览器打开</p>
  ) : null

  // 媒体元素默认全宽 + 黑底。
  const mediaClass = ["w-full", "rounded", "bg-black", className].filter(Boolean).join(" ")

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

  if (isProgressiveVideo(stream)) {
    return (
      <div className="space-y-1">
        {qualityBar}
        {headerHint}
        {/* autoPlay 由上方 effect 处理:先带声 play(),被拦降级静音。 */}
        <video ref={videoRef} src={stream.url} controls preload="none" className={mediaClass} />
      </div>
    )
  }

  if (isProgressiveAudio(stream)) {
    return (
      <div className="space-y-1">
        {qualityBar}
        {headerHint}
        <audio
          src={stream.url}
          controls
          autoPlay={autoPlay}
          muted={autoPlay}
          preload="none"
          className={mediaClass}
        />
      </div>
    )
  }

  // HLS / FLV → useMediaStream 已挂载(hls.js / flv.js)。preload 交给 MSE 库控制。
  return (
    <div className="space-y-1">
      {qualityBar}
      <video ref={videoRef} controls autoPlay={autoPlay} className={mediaClass} />
    </div>
  )
}
