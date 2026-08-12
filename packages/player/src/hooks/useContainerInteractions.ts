/**
 * useContainerInteractions —— 容器级交互:键盘快捷键 + 点击聚焦 + 单击播放/双击全屏。
 *
 * 键盘(焦点在容器内):Space/K 播放暂停、←/→ ±5s、↑/↓ 音量、M 静音、F 全屏、
 * Home/End 起终点、数字 0-9 跳 10% 档(live 除外)。忽略焦点在输入/按钮等可编辑目标。
 * 状态经 ref 持有,避免 timeupdate(4Hz)重渲染导致监听反复重绑。
 */
import { useCallback, useEffect, useRef } from "react"
import type { VideoOps, VideoPlayState } from "./useVideoElement.ts"

/** 键盘应忽略的焦点目标(输入/按钮/slider 自带键盘交互)。 */
function isEditableTarget(el: Element | null): boolean {
  if (!el) return false
  if (el.matches("input, textarea, select, [contenteditable]")) return true
  if (el.getAttribute("role") === "slider") return true
  const t = el.tagName.toLowerCase()
  return t === "button" || t === "a"
}

export function useContainerInteractions(
  containerRef: React.RefObject<HTMLDivElement | null>,
  state: VideoPlayState,
  ops: VideoOps,
  fullscreenToggle: () => void,
): { handleClick: () => void } {
  // 最新 state/ops/toggle 用 ref 持有:回调读最新值,不因 timeupdate 重建闭包。
  const stateRef = useRef(state)
  stateRef.current = state
  const opsRef = useRef(ops)
  opsRef.current = ops
  const fsRef = useRef(fullscreenToggle)
  fsRef.current = fullscreenToggle

  // 键盘:容器 keydown 域。挂载一次,回调内从 ref 读最新。
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement
      if (active && active !== el && isEditableTarget(active)) return
      if (e.altKey || e.ctrlKey || e.metaKey) return
      const s = stateRef.current
      const o = opsRef.current
      const k = e.key.toLowerCase()
      const handled =
        (e.key === " " || k === "k")
          ? (o.togglePlay(), true)
          : e.key === "ArrowLeft"
            ? (o.seek(s.currentTime - 5), true)
            : e.key === "ArrowRight"
              ? (o.seek(s.currentTime + 5), true)
              : e.key === "ArrowUp"
                ? (o.changeVolume(s.volume + 0.1), true)
                : e.key === "ArrowDown"
                  ? (o.changeVolume(s.volume - 0.1), true)
                  : k === "m"
                    ? (o.toggleMute(), true)
                    : k === "f"
                      ? (fsRef.current(), true)
                      : e.key === "Home"
                        ? (o.seek(0), true)
                        : e.key === "End"
                          ? (o.seek(s.live ? s.bufferedEnd : s.duration), true)
                          : /^[0-9]$/.test(e.key) && !s.live
                            ? (o.seek((s.duration / 10) * Number(e.key)), true)
                            : false
      if (handled) e.preventDefault()
    }
    el.addEventListener("keydown", onKeyDown)
    return () => el.removeEventListener("keydown", onKeyDown)
  }, [containerRef])

  // 点击容器(含视频画面)时聚焦,让键盘可用。不抢控件按钮焦点(按钮聚焦后空格=击键)。
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onPointerDown = (e: PointerEvent) => {
      if (isEditableTarget(e.target as Element)) return
      el.focus({ preventScroll: true })
    }
    el.addEventListener("pointerdown", onPointerDown)
    return () => el.removeEventListener("pointerdown", onPointerDown)
  }, [containerRef])

  // 单击切播放/暂停;双击两次 click 的 toggle 抵消(播→暂停→播),再由 onDoubleClick 全屏。
  const handleClick = useCallback(() => {
    opsRef.current.togglePlay()
  }, [])

  return { handleClick }
}
