/**
 * useVideoElement —— 同步 <video> 播放状态 + 暴露统一操作。
 *
 * 覆盖原生 <video>/<audio>(mp4/hls/flv/dash 的 DOM 层)。控件层只读这里的
 * state/clock + 调这里的操作,不直接碰媒体元素:
 *   - state(冷字段,React state):paused / duration / volume / muted / playbackRate /
 *     waiting / ended / started / live;
 *   - clock(热字段,外部 store,见 mediaClock.ts):currentTime / bufferedEnd ——
 *     timeupdate ~4Hz,若写进 React state 会让整个播放器树每秒重渲 4 次(P0b-1)。
 *     消费方用 `useMediaTime(clock, selector)` 按原始值切片订阅;
 *   - ops:togglePlay / seek / changeVolume / toggleMute / changeRate / setLiveEdge。
 *
 * 关键设计:
 *   - 事件分流:timeupdate/progress 只写 clock(不 setState);其余事件写冷 state。
 *   - buffered 用 timeRanges 末尾一段(对渐进式/HLS/DASH 都是「已缓冲最近点」)。
 *   - 直播判定:流媒体 `!isFinite(duration)` 或 duration === 0 视为 live;
 *     非流媒体(原生 mp4/audio)用 `duration !== Infinity` 区分(VOD),无限时长视为 live。
 *   - **播放偏好**(音量/静音/倍速)全局持久化(PlayerPrefs):挂载时应用,媒体事件
 *     变化时保存 —— 换条目不重置(P0a-3)。
 */

import { useCallback, useEffect, useRef, useState } from "react"

import { log } from "../log/index.ts"
import { applyPlayerPrefs, loadPlayerPrefs, savePlayerPrefs } from "../prefs.ts"
import { createMediaClock, type MediaClock } from "./mediaClock.ts"

export interface VideoPlayState {
  paused: boolean
  ended: boolean
  duration: number
  volume: number
  muted: boolean
  playbackRate: number
  waiting: boolean
  /** 是否已起播过(playing/play 事件触发后置 true)——区分「自动起播等待」vs「播放后暂停」。 */
  started: boolean
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
  duration: 0,
  volume: 1,
  muted: false,
  playbackRate: 1,
  waiting: false,
  started: false,
  live: false,
}

/** 读已缓冲区间的最远点(无 buffered 信息 → 0)。 */
function readBufferedEnd(el: HTMLMediaElement): number {
  const tr = el.buffered
  if (!tr || tr.length === 0) return 0
  let end = 0
  for (let i = 0; i < tr.length; i++) {
    const e = tr.end(i)
    if (e > end) end = e
  }
  return end
}

export function useVideoElement(
  videoRef: React.RefObject<HTMLMediaElement | null>,
  isStreaming: boolean,
  onMediaError?: (code: number | undefined, msg: string) => void,
  /**
   * 宿主显式声明的直播态(按条目 kind)。undefined = 未声明,回退媒体元数据。
   * ⚠️ 必比 `duration` 可靠:直播 HLS 的 duration 可能是有限的 playlist 窗口,
   * 而元素复用时会短暂保留上一条点播的 duration —— 两者都会把直播误判成点播。
   */
  live?: boolean,
): { state: VideoPlayState; ops: VideoOps; clock: MediaClock } {
  const [state, setState] = useState<VideoPlayState>(INITIAL)
  // 热字段外部 store(跨重渲稳定;不触发本组件渲染)。
  const clockRef = useRef<MediaClock | null>(null)
  if (!clockRef.current) clockRef.current = createMediaClock()
  const clock = clockRef.current

  // onMediaError 用 ref 持最新(与 onErrorRef 同模式):父组件每次渲染传新函数,
  // 但监听 effect 不该因它重跑。
  const onMediaErrorRef = useRef(onMediaError)
  onMediaErrorRef.current = onMediaError

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    // 播放偏好(volume/muted)应用一次 —— 换条目不重置。倍速见 applyRatePref。
    applyPlayerPrefs(video)
    // 显式直播:倍速恒 1×。元素可能留着上一条点播的倍速(如偏好里的 2×),
    // 不清掉会让直播在 2× 下追不上直播边缘,表现为反复卡顿。
    if (live === true) {
      try {
        video.playbackRate = 1
      } catch {
        // ignore
      }
    }
    /** 点播倍速:宿主未声明直播 + 时长已确认后应用一次。 */
    let ratePrefApplied = false
    const applyRatePref = () => {
      if (ratePrefApplied || live === true) return
      if (!(Number.isFinite(video.duration) && video.duration > 0)) return
      ratePrefApplied = true
      const rate = loadPlayerPrefs().rate
      if (rate !== 1) {
        try {
          video.playbackRate = rate
        } catch {
          // ignore
        }
      }
    }
    // 元素可能已带元数据(复用/二次挂载),先试一次;否则等 durationchange。
    applyRatePref()

    /** 写热字段(时间/缓冲),不触发 React 渲染。 */
    const readClock = () => {
      const el = videoRef.current
      if (!el) return
      clock.update(el.currentTime, readBufferedEnd(el))
    }

    /** 写冷字段(低频事件;timeupdate 不调它)。 */
    const readCold = () => {
      const el = videoRef.current
      if (!el) return
      // duration 在直播流(hls/flv/dash)下是 Infinity / NaN;原生 mp4 是有限秒数。
      const dur = Number.isFinite(el.duration) ? el.duration : 0
      setState((prev) => ({
        paused: el.paused,
        ended: el.ended,
        duration: dur,
        volume: el.volume,
        muted: el.muted,
        playbackRate: el.playbackRate,
        waiting: prev.waiting, // 由 waiting/playing 事件精确控制
        started: prev.started, // 由 play/playing 事件置位
        // 宿主声明的直播态优先:直播 HLS 的 duration 可能是有限窗口（B站实测 ≈218s），
        // 只按 duration 判会把直播误当点播。未声明才回退元数据。
        live: live ?? dur <= 0,
      }))
    }

    const onTimeUpdate = () => readClock()
    const onProgress = () => readClock()
    const onDurationChange = () => {
      readCold()
      readClock()
      // 首次确认有限时长(点播)→ 应用偏好倍速(显式直播不应用)。
      applyRatePref()
    }
    const onVolumeChange = () => readCold()
    const onRateChange = () => readCold()
    const onPlay = () => {
      log.play()
      setState((p) => ({ ...p, paused: false, ended: false, started: true }))
    }
    const onPause = () => {
      log.pause()
      setState((p) => ({ ...p, paused: true }))
    }
    const onEnded = () => {
      log.ended()
      setState((p) => ({ ...p, paused: true, ended: true }))
    }
    const onWaiting = () => {
      log.waiting()
      setState((p) => ({ ...p, waiting: true }))
    }
    const onPlaying = () => {
      log.playing()
      setState((p) => ({ ...p, waiting: false, started: true }))
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
    const onError = () => {
      const el = videoRef.current
      const code = el?.error?.code
      const msg = el?.error?.message ?? ""
      log.mediaError({ code, msg })
      onMediaErrorRef.current?.(code, msg)
    }
    video.addEventListener("error", onError)

    // 初始读取一次(已有元数据 / 直播自动起播)。
    readCold()
    readClock()

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
  }, [videoRef, isStreaming, clock, live])

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
      const dur = Number.isFinite(el.duration) ? el.duration : 0
      // 直播:seek 到已缓冲区间内(短延迟 DVR);越界 clamp 到 bufferedEnd。
      const max = dur > 0 ? dur : clock.state.bufferedEnd
      const target = Math.max(0, Math.min(time, max))
      try {
        el.currentTime = target
      } catch {
        // 个别状态(未加载完)抛 InvalidStateError,忽略。
      }
    },
    [videoRef, clock],
  )

  const changeVolume = useCallback(
    (volume: number) => {
      const el = videoRef.current
      if (!el) return
      const v = Math.max(0, Math.min(1, volume))
      el.volume = v
      if (v > 0 && el.muted) el.muted = false
      savePlayerPrefs({ volume: v, muted: el.muted })
    },
    [videoRef],
  )

  const toggleMute = useCallback(() => {
    const el = videoRef.current
    if (!el) return
    el.muted = !el.muted
    savePlayerPrefs({ muted: el.muted })
  }, [videoRef])

  const changeRate = useCallback(
    (rate: number) => {
      const el = videoRef.current
      if (!el) return
      try {
        el.playbackRate = rate
        // 直播的 duration 可能是有限值,不能拿它当点播判据 —— 用显式 live。
        if (live !== true && Number.isFinite(el.duration) && el.duration > 0) savePlayerPrefs({ rate })
      } catch {
        // 某些 webview 不支持自定义倍速,忽略。
      }
    },
    [videoRef, live],
  )

  const setLiveEdge = useCallback(() => {
    const el = videoRef.current
    if (!el) return
    const end = clock.state.bufferedEnd
    if (end > 0) {
      try {
        el.currentTime = end
      } catch {
        // ignore
      }
    }
  }, [videoRef, clock])

  return { state, ops: { togglePlay, seek, changeVolume, toggleMute, changeRate, setLiveEdge }, clock }
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
        doc.exitFullscreen ?? (doc as Document & { webkitExitFullscreen?: () => Promise<void> }).webkitExitFullscreen
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
