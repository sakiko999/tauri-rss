/**
 * PlayableMedia —— 可播放媒体容器(video/audio/live 共用)。
 *
 * 封装「懒解析 + 播放」两阶段 + 按格式分发渲染:
 *   - 有初始流(refresh 已带,如 audio 的 stream)→ 直接内嵌播放;
 *   - 无流 → 显示「播放」按钮,点击调 `resolve()` 拿 MediaStream[] 再播。
 *   resolve 由宿主(App 层)注入——它绑定 DataLayer 的 resolvePlay/resolveLivePlay。
 *
 * 渲染分发(单流,stream 由 useStreamSelection 选出):
 *   - mp4/webm → VideoShell 原生 <video>;  m3u8/flv/dash → VideoShell + useMediaStream;
 *   - mp3/aac/ogg → AudioShell 原生 <audio>(无画面,保留浏览器控件);
 *   - rtmp:// 协议 → 浏览器播不了,占位提示。
 *
 * 注意:原生 <video>/<audio> 无法带自定义 header(如 bilibili 直链的 referer)。
 * 带 headers 的 mp4 原生播可能 403 —— 当前如实提示;hls.js 经 xhrSetup 可带。
 */
import { useEffect, useRef, useState } from "react"
import type { MediaStream } from "@tauri-playground/core"
import { useMediaStream } from "./hooks/useMediaStream.ts"
import {
  isProgressiveAudio,
  isProgressiveVideo,
  isRtmp,
  isStreamingStream,
  useStreamSelection,
} from "./hooks/useStreamSelection.ts"
import { attemptPlayWithMuteFallback } from "./utils/attemptPlay.ts"
import { log } from "./utils/log.ts"
import { AudioShell } from "./AudioShell.tsx"
import { VideoShell } from "./VideoShell.tsx"

/**
 * 在用户手势内解锁浏览器 autoplay policy(带声音自动播放)。
 *
 * Chromium/WebView2 只允许「用户手势触发」的带声音自动播放;我们点「播放」
 * 按钮后 resolve 是异步的,video 在结果返回后才渲染,手势已过期 → 被拦。
 * 解法:点击瞬间(手势内)resume 一个 AudioContext,把文档标记为已获授权,
 * 之后同文档的 `<video>.play()` 带声音即可通过。幂等(只解锁一次)。
 */
let audioUnlocked = false
export function unlockAudioPlayback(): void {
  if (audioUnlocked) return
  audioUnlocked = true
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor()
    if (ctx.state === "suspended") void ctx.resume()
    // 持有引用防 GC 后 context 被回收导致授权丢失。
    ;(window as unknown as { __unlockCtx?: AudioContext }).__unlockCtx = ctx
  } catch {
    // 环境无 AudioContext(罕见),放弃解锁——play() 会被拦,降级静音。
  }
}

export function PlayableMedia({
  streams,
  resolve,
  className,
  onError,
  autoResolve = false,
  fill = false,
}: {
  /** refresh 已带的可播流(可选)。 */
  streams?: MediaStream[]
  /** 懒解析函数:点击播放时调用,返回可播流。 */
  resolve?: () => Promise<MediaStream[]>
  className?: string
  onError?: (err: unknown) => void
  /** 挂载后立即懒解析起播(模态大播放器用,无需点按钮)。 */
  autoResolve?: boolean
  /** 填满父容器(父已定比例)——透传给 VideoShell,避免双撑首帧塌缩。 */
  fill?: boolean
}) {
  const [resolved, setResolved] = useState<MediaStream[] | null>(null)
  const [resolving, setResolving] = useState(false)
  const [error, setError] = useState<unknown>(null)
  // 切档后仍要传 error 给 useMediaStream;error 展示由 error state 管。
  const [playError, setPlayError] = useState<unknown>(null)
  const [retryKey, setRetryKey] = useState(0)
  const resolveRef = useRef(resolve)
  resolveRef.current = resolve

  // 最终播放用的流:初始流或懒解析结果。
  const playStreams = resolved ?? streams ?? []
  const hasPlayable = playStreams.length > 0

  async function handlePlay() {
    if (!resolve) return
    // 用户手势内解锁 autoplay,resolve 完成后 video 才能带声音自动播。
    log.resolveStart()
    unlockAudioPlayback()
    setResolving(true)
    setError(null)
    try {
      const result = await resolve()
      log.resolveSuccess(result.length)
      setResolved(result)
    } catch (err) {
      log.resolveFailed(err)
      setError(err)
      onError?.(err)
    } finally {
      setResolving(false)
    }
  }

  // 模态大播放器:挂载即自动懒解析起播(用户点「大屏」按钮时已在手势内,无需再点「播放」)。
  // 用 ref 持 resolve,effect 只跑一次(StrictMode 双挂载幂等:第二次挂载 resolved 已非空直接播)。
  const startedRef = useRef(false)
  useEffect(() => {
    if (!autoResolve) return
    if (startedRef.current || resolved) return
    startedRef.current = true
    void handlePlay()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoResolve])

  // 选流 + 档位。
  const { stream, qualityOptions, switchQuality } = useStreamSelection(playStreams)

  // 诊断:打印最终选中的流(url 域名/截断 + format + headers 键),排查清晰度/来源。
  useEffect(() => {
    if (!stream) return
    log.streamSelected(stream, Object.keys(stream.headers ?? {}))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream])

  // 流媒体驱动(hls/flv/dash)→ useMediaStream 接管 video;原生 src 由 VideoShell 写。
  const needsStreamPlayer = !!stream && isStreamingStream(stream)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  // 引擎选择:流媒体 → useMediaStream(hls/flv/dash);原生 → VideoShell <video>。
  useEffect(() => {
    if (!stream) return
    log.engineSelected(
      needsStreamPlayer ? "stream" : isProgressiveVideo(stream) ? "video" : isProgressiveAudio(stream) ? "audio" : "fallback",
      stream.format,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream, needsStreamPlayer])

  // autoPlay 语义:用户点过「播放」(resolved !== null)→ 自动带声起播;初始流未点击不自动播。
  const autoPlay = resolved !== null

  useMediaStream({
    stream: needsStreamPlayer ? stream : null,
    videoRef,
    autoPlay,
    // retryKey 变化强制 useMediaStream 重建播放实例(错误重试)。
    retryKey,
    onError: (e) => {
      setPlayError(e)
      onError?.(e)
    },
  })

  // 原生 mp4 分支的自动播放:与 HLS 对齐,**等媒体可播(canplay)后**带声 play。
  // ⚠️ 不能 src 刚设就立即 play:此时媒体未加载,autoplay policy 判定不稳定,
  // 带声 play 易被拦 → 降级静音(实测 video 静音、live 有声即因此——live 走 HLS
  // 在 canplay 才 play,媒体已就绪)。canplay 时媒体已加载,带声 play 最可能放行。
  // 被拦降级静音(保底可播);StrictMode 双挂载:第一个 video 被移除,检查 isConnected。
  const isNativeStream = !!stream && !needsStreamPlayer && isProgressiveVideo(stream)
  useEffect(() => {
    if (!autoPlay || !isNativeStream) return
    const el = videoRef.current
    if (!el) return
    const attemptUnmuted = () => {
      if (!el.isConnected) return
      el.muted = false
      // 带声 play;被 policy 拦 → 静音重试(attemptPlay 内部)。AbortError 不降级。
      attemptPlayWithMuteFallback(el, () => el.play(), { autoPlay, onFail: (e) => setPlayError(e) })
    }
    // 只等 canplay(媒体可播)再带声 play——**不要立即 play**:src 刚设媒体未
    // 加载,立即 play 易被判失败 → 降级静音(YouTube video 静音即因此)。
    el.addEventListener("canplay", attemptUnmuted, { once: true })
    return () => el.removeEventListener("canplay", attemptUnmuted)
  }, [autoPlay, isNativeStream, stream?.url])

  // 解析失败展示。
  if (error) {
    return (
      <div className="rounded border border-red-300 p-2 text-sm text-red-600">
        解析失败:{error instanceof Error ? error.message : String(error)}
      </div>
    )
  }

  if (!hasPlayable) {
    return (
      <div>
        <button
          onClick={handlePlay}
          disabled={!resolve || resolving}
          className="rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 disabled:opacity-50"
        >
          {resolving ? "解析中…" : "▶ 播放"}
        </button>
      </div>
    )
  }

  if (!stream) {
    return <div className="rounded border border-zinc-300 p-4 text-center text-sm text-zinc-500">无可播流</div>
  }

  if (playError) {
    return (
      <div className="space-y-2 rounded border border-red-300 p-4 text-center text-sm text-red-600">
        <p>播放失败:{playError instanceof Error ? playError.message : String(playError)}</p>
        <button
          type="button"
          onClick={() => {
            log.userRetry()
            setPlayError(null)
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

  // 带 referer 头的渐进式直链原生播可能被 CDN 拒(浏览器无法带自定义 header)。
  // 作为 title 提示挂外壳,不进流式布局(避免与 video 并列占行)。
  const headerHintTitle = stream.headers ? "该直链可能需要 referer 头,若播放失败请用浏览器打开" : undefined

  // 渐进式视频 / HLS / FLV / DASH → VideoShell 外壳(自定义控件)。
  if (isProgressiveVideo(stream) || needsStreamPlayer) {
    return (
      <VideoShell
        videoRef={videoRef}
        isStreaming={needsStreamPlayer}
        src={isProgressiveVideo(stream) ? stream.url : undefined}
        autoPlay={autoPlay}
        qualityOptions={qualityOptions}
        activeQuality={stream.rate}
        onQuality={switchQuality}
        onMediaError={(code, msg) => {
          setPlayError(new Error(`原生媒体错误(code=${code ?? "?"}): ${msg}`))
          onError?.(new Error(msg))
        }}
        title={headerHintTitle}
        fill={fill}
      />
    )
  }

  // 渐进式音频(mp3/aac/ogg)→ AudioShell 原生 <audio>。
  if (isProgressiveAudio(stream)) {
    return (
      <AudioShell
        src={stream.url}
        autoPlay={autoPlay}
        onError={(e) => {
          setPlayError(e)
          onError?.(e)
        }}
        qualityOptions={qualityOptions}
        activeQuality={stream.rate}
        onQuality={switchQuality}
        className={className}
      />
    )
  }

  // 未知流类型:兜底原生 <video>。
  return (
    <div className="space-y-1">
      <video ref={videoRef} controls autoPlay={autoPlay} className={["w-full rounded bg-black", className].filter(Boolean).join(" ")} />
    </div>
  )
}
