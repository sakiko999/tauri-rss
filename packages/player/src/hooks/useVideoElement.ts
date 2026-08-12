/**
 * useVideoElement —— 同步 <video> 播放状态 + 暴露统一操作。
 *
 * 覆盖原生 <video>(mp4/hls/flv/dash 的 DOM 层)。控件层(SeekBar/PlayerControls/
 * VideoShell)只读这里的 state + 调这里的操作,不直接碰 media 元素:
 *   - state: paused / currentTime / duration / buffered / volume / muted / playbackRate
 *            waiting(缓冲中) / ended / live(直播流无 duration)
 *   - ops: togglePlay / seek / changeVolume / toggleMute / changeRate / setLiveEdge
 *
 * 关键设计:
 *   - 监听 timeupdate(4Hz)/durationchange/progress(缓冲)/volumechange/ratechange/
 *     waiting/playing/play/pause/ended 等媒体事件,setState 驱动 React 渲染。
 *   - buffered 用 timeRanges 末尾一段(对渐进式/HLS/DASH 都是「已缓冲最近点」)。
 *   - 直播判定:流媒体 `!isFinite(duration)` 或 duration === 0 视为 live;
 *     非流媒体(原生 mp4/audio)用 `duration !== Infinity` 区分(VOD),无限时长视为 live。
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { playableDuration } from "../utils/buffer.ts"
import { log } from "../utils/log.ts"

export interface BufferedRange {
  start: number
  end: number
}

export interface VideoPlayState {
  paused: boolean
  ended: boolean
  currentTime: number
  duration: number
  buffered: BufferedRange[]
  bufferedEnd: number
  volume: number
  muted: boolean
  playbackRate: number
  waiting: boolean
  /** 直播流(无固定时长)→ 进度条/时间显示按 live 模式渲染。 */
  live: boolean
}

export interface VideoOps {
  togglePlay: () => void
  seek: (time: number) => void
  changeVolume: (volume: number) => void
  toggleMute: () => void
  changeRate: (rate: number) => void
  /** 直播跳转到最接近边缘(DVR)。 */
  setLiveEdge: () => void
}

export interface FullscreenApi {
  isFullscreen: boolean
  toggle: () => void
}

const INITIAL: VideoPlayState = {
  paused: true,
  ended: false,
  currentTime: 0,
  duration: 0,
  buffered: [],
  bufferedEnd: 0,
  volume: 1,
  muted: false,
  playbackRate: 1,
  waiting: false,
  live: false,
}

export function useVideoElement(
  videoRef: React.RefObject<HTMLMediaElement | null>,
  isStreaming: boolean,
  onMediaError?: (code: number | undefined, msg: string) => void,
): { state: VideoPlayState; ops: VideoOps } {
  const [state, setState] = useState<VideoPlayState>(INITIAL)

  // onMediaError 用 ref 持最新(与 onErrorRef 同模式):父组件每次渲染传新函数,
  // 但监听 effect 不该因它重跑。
  const onMediaErrorRef = useRef(onMediaError)
  onMediaErrorRef.current = onMediaError

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const read = () => {
      const el = videoRef.current
      if (!el) return
      // duration 在直播流(hls/flv/dash)下是 Infinity / NaN;原生 mp4 是有限秒数。
      const dur = Number.isFinite(el.duration) ? el.duration : 0
      // 流媒体:duration 无效 → live;原生媒体:Infinity 时长(流媒体直播)也 live。
      const live = isStreaming ? dur <= 0 : dur === Infinity
      const tr = el.buffered
      const buffered: BufferedRange[] = []
      let bufferedEnd = 0
      if (tr && tr.length > 0) {
        for (let i = 0; i < tr.length; i++) {
          const start = tr.start(i)
          const end = tr.end(i)
          buffered.push({ start, end })
          if (end > bufferedEnd) bufferedEnd = end
        }
      }
      setState((prev) => ({
        paused: el.paused,
        ended: el.ended,
        currentTime: el.currentTime,
        duration: dur,
        buffered,
        bufferedEnd,
        volume: el.volume,
        muted: el.muted,
        playbackRate: el.playbackRate,
        waiting: prev.waiting, // 由 waiting/playing 事件精确控制,timeupdate 不改动
        live,
      }))
    }

    // 事件源:驱动 state 更新的高频/低频媒体事件。
    const onTimeUpdate = () => read()
    const onDurationChange = () => read()
    const onProgress = () => read() // 缓冲推进:更新 buffered 段
    const onVolumeChange = () => read()
    const onRateChange = () => read()
    const onPlay = () => {
      log.mediaEvent("play")
      setState((p) => ({ ...p, paused: false, ended: false }))
    }
    const onPause = () => {
      log.mediaEvent("pause")
      setState((p) => ({ ...p, paused: true }))
    }
    const onEnded = () => {
      log.mediaEvent("ended")
      setState((p) => ({ ...p, paused: true, ended: true }))
    }
    const onWaiting = () => {
      log.mediaEvent("waiting")
      setState((p) => ({ ...p, waiting: true }))
    }
    const onPlaying = () => {
      log.mediaEvent("playing")
      setState((p) => ({ ...p, waiting: false }))
    }
    const onCanPlay = () => setState((p) => ({ ...p, waiting: false }))

    video.addEventListener("timeupdate", onTimeUpdate)
    video.addEventListener("durationchange", onDurationChange)
    video.addEventListener("progress", onProgress)
    video.addEventListener("volumechange", onVolumeChange)
    video.addEventListener("ratechange", onRateChange)
    video.addEventListener("play", onPlay)
    video.addEventListener("pause", onPause)
    video.addEventListener("ended", onEnded)
    video.addEventListener("waiting", onWaiting)
    video.addEventListener("playing", onPlaying)
    video.addEventListener("canplay", onCanPlay)
    // 原生 video 加载失败(403/网络断/格式不支持)的最终信号——流媒体引擎错误
    // 走 useMediaStream 的 report;原生 mp4/audio 只能靠这里(媒体错误码)。
    // 打日志 + 上报 onMediaError,让 PlayableMedia 能弹 playError UI/重试。
    const onError = () => {
      const el = videoRef.current
      const code = el?.error?.code
      const msg = el?.error?.message ?? ""
      log.mediaError(code, msg)
      onMediaErrorRef.current?.(code, msg)
    }
    video.addEventListener("error", onError)

    // 初始读取一次(已有元数据 / 直播自动起播)。
    read()

    return () => {
      video.removeEventListener("timeupdate", onTimeUpdate)
      video.removeEventListener("durationchange", onDurationChange)
      video.removeEventListener("progress", onProgress)
      video.removeEventListener("volumechange", onVolumeChange)
      video.removeEventListener("ratechange", onRateChange)
      video.removeEventListener("play", onPlay)
      video.removeEventListener("pause", onPause)
      video.removeEventListener("ended", onEnded)
      video.removeEventListener("waiting", onWaiting)
      video.removeEventListener("playing", onPlaying)
      video.removeEventListener("canplay", onCanPlay)
      video.removeEventListener("error", onError)
    }
  }, [videoRef, isStreaming])

  const togglePlay = useCallback(() => {
    const el = videoRef.current
    if (!el) return
    if (el.paused || el.ended) {
      const p = el.play() as Promise<void> | void
      if (p && typeof p.catch === "function") p.catch(() => {})
    } else {
      el.pause()
    }
  }, [videoRef])

  const seek = useCallback(
    (time: number) => {
      const el = videoRef.current
      if (!el) return
      // 直播:seek 到已缓冲区间内(短延迟 DVR);越界 clamp 到 bufferedEnd。
      const max = playableDuration(state)
      const target = Math.max(0, Math.min(time, max))
      try {
        el.currentTime = target
      } catch {
        // 个别状态(未加载完)抛 InvalidStateError,忽略。
      }
    },
    [videoRef, state.live, state.bufferedEnd, state.duration],
  )

  const changeVolume = useCallback(
    (volume: number) => {
      const el = videoRef.current
      if (!el) return
      const v = Math.max(0, Math.min(1, volume))
      el.volume = v
      if (v > 0 && el.muted) el.muted = false
    },
    [videoRef],
  )

  const toggleMute = useCallback(() => {
    const el = videoRef.current
    if (!el) return
    el.muted = !el.muted
  }, [videoRef])

  const changeRate = useCallback(
    (rate: number) => {
      const el = videoRef.current
      if (!el) return
      try {
        el.playbackRate = rate
      } catch {
        // 某些 webview 不支持自定义倍速,忽略。
      }
    },
    [videoRef],
  )

  const setLiveEdge = useCallback(() => {
    const el = videoRef.current
    if (!el) return
    const end = playableDuration(state)
    if (end > 0) {
      try {
        el.currentTime = end
      } catch {
        // ignore
      }
    }
  }, [videoRef, state.live, state.bufferedEnd, state.duration])

  return { state, ops: { togglePlay, seek, changeVolume, toggleMute, changeRate, setLiveEdge } }
}

/** 把文档全屏切换能力绑定到容器元素(fullscreenchange 同步 isFullscreen)。 */
export function bindFullscreen(
  containerRef: React.RefObject<HTMLElement | null>,
  setFullscreen: (v: FullscreenApi) => void,
): () => void {
  const el = containerRef.current
  if (!el) return () => {}
  const doc = el.ownerDocument
  const getFullscreenElement = () => {
    const de = doc.fullscreenElement as HTMLElement | null
    if (de) return de
    return (doc as Document & { webkitFullscreenElement?: HTMLElement | null }).webkitFullscreenElement ?? null
  }

  const isActive = () => getFullscreenElement() === el

  const toggle = () => {
    if (isActive()) {
      const exit =
        doc.exitFullscreen ??
        (doc as Document & { webkitExitFullscreen?: () => Promise<void> }).webkitExitFullscreen
      if (exit) exit.call(doc)
    } else {
      const req =
        el.requestFullscreen ??
        (el as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen
      if (req) req.call(el)
    }
  }

  const sync = () => setFullscreen({ isFullscreen: isActive(), toggle })

  sync()
  doc.addEventListener("fullscreenchange", sync)
  doc.addEventListener("webkitfullscreenchange", sync)
  return () => {
    doc.removeEventListener("fullscreenchange", sync)
    doc.removeEventListener("webkitfullscreenchange", sync)
  }
}
