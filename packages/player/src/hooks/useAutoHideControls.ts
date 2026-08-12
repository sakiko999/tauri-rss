/**
 * useAutoHideControls —— 控件层显隐状态。
 *
 * 规则:播放中鼠标静止 AUTOHIDE_MS 隐藏;移动/触摸/暂停/缓冲立即显示;悬停控件栏不隐藏。
 * 缓冲(waiting)另延迟 BUFFER_MS 显示 spinner,恢复立即消失。
 */
import { useCallback, useEffect, useRef, useState } from "react"
import type { VideoPlayState } from "./useVideoElement.ts"

const AUTOHIDE_MS = 2500
const BUFFER_MS = 400

export function useAutoHideControls(state: VideoPlayState): {
  showControls: boolean
  showSpinner: boolean
  /** 主动唤出控件(鼠标移动/进入),随后按需重新排隐藏。 */
  poke: () => void
  /** 立即隐藏(鼠标离开播放器)。 */
  hide: () => void
  /** 悬停控件栏:唤出并暂停隐藏计时。 */
  hover: () => void
  /** 离开控件栏:恢复自动隐藏。 */
  leave: () => void
} {
  const [showControls, setShowControls] = useState(true)
  const [showSpinner, setShowSpinner] = useState(false)
  const hideTimer = useRef<number | null>(null)
  const spinnerTimer = useRef<number | null>(null)

  const clearHide = () => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
  }

  const scheduleHide = useCallback(() => {
    clearHide()
    hideTimer.current = window.setTimeout(() => {
      hideTimer.current = null
      // 计时结束时若已暂停/缓冲则保持显示,否则隐藏。
      setShowControls(!state.paused && !state.waiting ? false : true)
    }, AUTOHIDE_MS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.paused, state.waiting])

  const poke = useCallback(() => {
    setShowControls(true)
    if (!state.paused && !state.waiting) scheduleHide()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.paused, state.waiting, scheduleHide])

  const hide = useCallback(() => {
    clearHide()
    setShowControls(false)
  }, [])

  const hover = useCallback(() => {
    setShowControls(true)
    clearHide()
  }, [])

  const leave = useCallback(() => {
    if (!state.paused) scheduleHide()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.paused, scheduleHide])

  // 播放中 → 排隐藏;暂停/缓冲 → 保持显示。独立 effect 处理状态切换时的清理。
  useEffect(() => {
    if (state.paused || state.waiting) {
      setShowControls(true)
      clearHide()
    } else {
      scheduleHide()
    }
    return clearHide
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.paused, state.waiting, scheduleHide])

  // 缓冲 spinner:waiting 延迟出现,恢复立即消失。
  useEffect(() => {
    if (state.waiting) {
      spinnerTimer.current = window.setTimeout(() => setShowSpinner(true), BUFFER_MS)
    } else {
      if (spinnerTimer.current !== null) window.clearTimeout(spinnerTimer.current)
      spinnerTimer.current = null
      setShowSpinner(false)
    }
    return () => {
      if (spinnerTimer.current !== null) window.clearTimeout(spinnerTimer.current)
      spinnerTimer.current = null
    }
  }, [state.waiting])

  return { showControls, showSpinner, poke, hide, hover, leave }
}
