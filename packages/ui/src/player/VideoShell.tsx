/**
 * VideoShell —— 播放器外壳:视频画面 + 控件层(自动隐藏 / 键盘 / 点击播放暂停 / 全屏 / 缓冲 / 居中播放键)。
 *
 * 职责:
 *   - 持有 `useVideoElement`(播放状态 + 操作),把 state/ops 喂给 PlayerControls / SeekBar。
 *   - 控件自动隐藏:播放时鼠标静止 2.5s 隐藏;移动鼠标 / 触摸 / 暂停 / 结束立即显示。
 *     悬停在控件栏上不隐藏。
 *   - 键盘快捷键(焦点在播放器内):Space/K(播放暂停)、←/→(±5s)、↑/↓(音量)、M(静音)、
 *     F(全屏)、Home/End(起点/终点)、数字键(跳 10% 档)。忽略焦点在输入/按钮/SeekBar 时的冲突。
 *   - 点击画面切播放/暂停(立即);双击全屏(两次 click 的 toggle 抵消,播放状态不变)。
 *   - 全屏:容器元素请求全屏,fullscreenchange 同步 state。
 *   - 缓冲指示:waiting 时显示 spinner(延迟 400ms 出现,防闪烁)。
 *
 * 布局:外层 `relative` 容器,`<video>` 填满;控件层 absolute 铺底。背景纯黑。
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { bindFullscreen, type FullscreenApi, useVideoElement } from "./useVideoElement.ts"
import { PlayerControls } from "./PlayerControls.tsx"
import { PlayIcon, SpinnerIcon } from "./icons.tsx"

const AUTOHIDE_DELAY_MS = 2500
const BUFFER_DELAY_MS = 400

/** 键盘快捷键应忽略的焦点元素(输入/按钮/SeekBar 等自带键盘交互)。 */
function isEditableTarget(el: Element | null): boolean {
  if (!el) return false
  if (el.matches("input, textarea, select, [contenteditable]")) return true
  if (el.getAttribute("role") === "slider") return true
  return el.tagName.toLowerCase() === "button" || el.tagName.toLowerCase() === "a"
}

export function VideoShell({
  videoRef,
  isStreaming,
  className,
  src,
  autoPlay = false,
  qualityOptions,
  activeQuality,
  onQuality,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>
  /** 是否由 useMediaStream(hls/flv/dash)驱动(决定直播判定)。 */
  isStreaming: boolean
  className?: string
  /** 原生渐进式视频的 src(streamed 由 MSE 库管理,不传)。 */
  src?: string
  /** 自动起播(用户点过「播放」→ resolve 后内嵌):起播瞬间不闪大播放键。 */
  autoPlay?: boolean
  qualityOptions: { rate: number; quality: string }[]
  activeQuality?: number
  onQuality: (rate: number) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const { state, ops } = useVideoElement(videoRef, isStreaming)

  // 原生 mp4:把 src 写进 <video> 元素(React 不管理该属性,手动赋值避免卸载重挂)。
  useEffect(() => {
    if (!src) return
    const el = videoRef.current
    if (!el) return
    el.src = src
  }, [src, videoRef])

  const [fullscreenState, setFullscreenState] = useState<FullscreenApi>({
    isFullscreen: false,
    toggle: () => {},
  })
  const [showControls, setShowControls] = useState(true)
  const [showSpinner, setShowSpinner] = useState(false)
  const hideTimerRef = useRef<number | null>(null)
  const spinnerTimerRef = useRef<number | null>(null)

  // 最新 state/ops 用 ref 持有:回调里读最新值,不因 timeupdate(4Hz)重建闭包。
  const stateRef = useRef(state)
  stateRef.current = state
  const opsRef = useRef(ops)
  opsRef.current = ops
  const fullscreenToggleRef = useRef(() => fullscreenState.toggle())
  fullscreenToggleRef.current = () => fullscreenState.toggle()

  // 全屏绑定:容器元素请求全屏,fullscreenchange 同步 state。
  useEffect(() => {
    const unsub = bindFullscreen(containerRef, setFullscreenState)
    return () => {
      unsub()
      setFullscreenState((prev) => ({ ...prev, isFullscreen: false }))
    }
  }, [])

  // 安排一次隐藏计时:播放中静止 AUTOHIDE_DELAY_MS 后隐藏;暂停/缓冲保持显示。
  const scheduleHide = useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current)
    }
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null
      const s = stateRef.current
      setShowControls((currently) => {
        if (s.paused || s.waiting) return true
        return currently ? false : currently
      })
    }, AUTOHIDE_DELAY_MS)
  }, [])

  // 主动显示控件;若播放中,静止 AUTOHIDE_DELAY_MS 后重新安排隐藏。
  const poke = useCallback(() => {
    setShowControls(true)
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
    const s = stateRef.current
    if (!s.paused && !s.waiting) {
      scheduleHide()
    }
  }, [scheduleHide])

  // 播放中 + 静止 → 自动隐藏;暂停/缓冲/未起播时保持显示。
  useEffect(() => {
    if (state.paused || state.waiting) {
      setShowControls(true)
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current)
        hideTimerRef.current = null
      }
      return
    }
    scheduleHide()
    return () => {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current)
        hideTimerRef.current = null
      }
    }
  }, [state.paused, state.waiting, scheduleHide])

  // 缓冲指示:waiting 延迟出现,恢复立即消失。
  useEffect(() => {
    if (state.waiting) {
      spinnerTimerRef.current = window.setTimeout(() => setShowSpinner(true), BUFFER_DELAY_MS)
    } else {
      if (spinnerTimerRef.current !== null) {
        window.clearTimeout(spinnerTimerRef.current)
        spinnerTimerRef.current = null
      }
      setShowSpinner(false)
    }
    return () => {
      if (spinnerTimerRef.current !== null) {
        window.clearTimeout(spinnerTimerRef.current)
        spinnerTimerRef.current = null
      }
    }
  }, [state.waiting])

  // 键盘快捷键(容器聚焦域内;点击画面即聚焦)。用 ref 持有最新 state/ops,
  // 避免 timeupdate(4Hz)导致 effect 反复重绑监听。
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement
      if (active && active !== el && isEditableTarget(active)) return
      if (e.altKey || e.ctrlKey || e.metaKey) return
      const s = stateRef.current
      const o = opsRef.current
      const key = e.key
      const k = key.toLowerCase()

      if (key === " " || k === "k") {
        e.preventDefault()
        o.togglePlay()
      } else if (key === "ArrowLeft") {
        e.preventDefault()
        o.seek(s.currentTime - 5)
      } else if (key === "ArrowRight") {
        e.preventDefault()
        o.seek(s.currentTime + 5)
      } else if (key === "ArrowUp") {
        e.preventDefault()
        o.changeVolume(s.volume + 0.1)
      } else if (key === "ArrowDown") {
        e.preventDefault()
        o.changeVolume(s.volume - 0.1)
      } else if (k === "m") {
        e.preventDefault()
        o.toggleMute()
      } else if (k === "f") {
        e.preventDefault()
        fullscreenToggleRef.current()
      } else if (key === "Home") {
        e.preventDefault()
        o.seek(0)
      } else if (key === "End") {
        e.preventDefault()
        o.seek(s.live ? s.bufferedEnd : s.duration)
      } else if (/^[0-9]$/.test(key) && !s.live) {
        e.preventDefault()
        o.seek((s.duration / 10) * Number(key))
      }
    }
    el.addEventListener("keydown", onKeyDown)
    return () => el.removeEventListener("keydown", onKeyDown)
  }, [])

  // 点击容器(含视频画面)时聚焦,让键盘快捷键可用。
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onPointerDown = (e: PointerEvent) => {
      // 不抢控件按钮的焦点(按钮聚焦后空格触击键)。
      if (isEditableTarget(e.target as Element)) return
      el.focus({ preventScroll: true })
    }
    el.addEventListener("pointerdown", onPointerDown)
    return () => el.removeEventListener("pointerdown", onPointerDown)
  }, [])

  // 点击画面:立即切播放/暂停(零延迟)。
  // 双击:两次 click 的 togglePlay 互相抵消(播→暂停→播),再由 onDoubleClick 切全屏。
  // 这正是 YouTube 的交互:双击只切全屏,播放状态不变。
  const handleClick = useCallback(() => {
    poke()
    opsRef.current.togglePlay()
  }, [poke])

  // 未起播(当前时间 0 且暂停)→ 大播放键。autoPlay 起播瞬间不闪(等 play 事件)。
  const showBigPlay = !autoPlay && state.paused && !state.ended && !state.waiting && state.currentTime === 0
  // 播放中暂停(中间态)→ 悬停显示播放键。
  const showPausedOverlay = state.paused && !showBigPlay && !state.ended

  const mediaClass = ["h-full", "w-full", "object-contain", className].filter(Boolean).join(" ")

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onMouseMove={poke}
      onMouseLeave={() => {
        if (!state.paused) scheduleHide()
      }}
      onClick={handleClick}
      onDoubleClick={(e) => {
        e.preventDefault()
        fullscreenToggleRef.current()
      }}
      className={[
        "group relative flex items-center justify-center overflow-hidden bg-black outline-none",
        fullscreenState.isFullscreen ? "h-full w-full" : "rounded",
      ].join(" ")}
    >
      <video ref={videoRef} className={mediaClass} playsInline preload="auto" />

      {/* 缓冲 spinner */}
      {showSpinner && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
          <SpinnerIcon className="h-12 w-12 animate-spin text-white/80" />
        </div>
      )}

      {/* 居中播放键(未起播):absolute + inset-0 m-auto 覆盖在 video 之上,与 video 不并列 */}
      {showBigPlay && (
        <button
          type="button"
          aria-label="播放"
          onClick={(e) => {
            e.stopPropagation()
            ops.togglePlay()
          }}
          className="absolute inset-0 m-auto flex h-16 w-16 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur transition hover:bg-white/30"
        >
          <PlayIcon className="h-8 w-8 translate-x-0.5" />
        </button>
      )}

      {/* 播放中暂停的悬停播放键:同上,absolute 覆盖 */}
      {showPausedOverlay && (
        <button
          type="button"
          aria-label="继续播放"
          onClick={(e) => {
            e.stopPropagation()
            ops.togglePlay()
          }}
          className="absolute inset-0 m-auto flex h-16 w-16 items-center justify-center rounded-full bg-black/40 text-white opacity-0 backdrop-blur transition hover:bg-black/60 group-hover:opacity-100"
        >
          <PlayIcon className="h-8 w-8 translate-x-0.5" />
        </button>
      )}

      {/* 控件层(自动隐藏) */}
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 transition-opacity duration-300 ${
          showControls ? "opacity-100" : "opacity-0"
        }`}
      >
        <div
          className="pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
          onMouseEnter={() => {
            // 悬停控件栏:取消隐藏计时
            setShowControls(true)
            if (hideTimerRef.current !== null) {
              window.clearTimeout(hideTimerRef.current)
              hideTimerRef.current = null
            }
          }}
          onMouseLeave={() => {
            if (!state.paused) scheduleHide()
          }}
        >
          <PlayerControls
            state={state}
            ops={ops}
            fullscreen={fullscreenState}
            qualityOptions={qualityOptions}
            activeQuality={activeQuality}
            onQuality={onQuality}
          />
        </div>
      </div>
    </div>
  )
}
