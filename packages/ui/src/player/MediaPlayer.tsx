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
import { useRef, useState } from "react"
import type { MediaStream } from "@tauri-playground/core"
import { isFlvStream, isHlsStream, useMediaStream } from "./useHls.ts"

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
  // 选流:渐进式优先(双端兼容),其次 hls/flv(流媒体)。
  const stream =
    streams.find(isProgressiveVideo) ??
    streams.find(isProgressiveAudio) ??
    streams.find(isHlsStream) ??
    streams.find(isFlvStream) ??
    streams[0]

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const needsStreamPlayer = !!stream && (isHlsStream(stream) || isFlvStream(stream))
  useMediaStream({
    stream: needsStreamPlayer ? stream : null,
    videoRef,
    onError: (e) => {
      setError(e)
      onError?.(e)
    },
  })

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

  if (isProgressiveVideo(stream)) {
    return (
      <div className="space-y-1">
        {headerHint}
        <video src={stream.url} controls autoPlay={autoPlay} preload="none" className={mediaClass} />
      </div>
    )
  }

  if (isProgressiveAudio(stream)) {
    return (
      <div className="space-y-1">
        {headerHint}
        <audio src={stream.url} controls autoPlay={autoPlay} preload="none" className={mediaClass} />
      </div>
    )
  }

  // HLS / FLV → useMediaStream 已挂载(hls.js / flv.js)。preload 交给 MSE 库控制。
  return <video ref={videoRef} controls autoPlay={autoPlay} className={mediaClass} />
}
