/**
 * AudioSession —— 播客单集的**会话级**播放器（跨路由存活）。
 *
 * 为什么要在路由之外：播放页一卸载，页面里的 `<audio>` 就跟着销毁。「离开播放页继续
 * 听」正是原型迷你条的语义。这里用一个模块级单例 `<audio>`（挂在 body 上）持有播放，
 * 播放页与迷你条都只是它的两个控制面。
 *
 * ⚠️ 只承担**渐进式音频**（播客单集：mp3/m4a/aac/ogg）。听视频是 DASH（dash.js 实例
 * + MPD 剥轨），仍归 `PlayableMedia` —— 离开播放页即停，不在本会话里。
 */

import type { MediaItem } from "@amoeba/core"
import { create } from "zustand"

import { useDesktop } from "../../store/index.ts"

/** 单例媒体元素：**永远不卸载**，播放跨路由存活。 */
const el = new Audio()
el.preload = "metadata"
document.body.appendChild(el)

/** 给 AudioShell 用的稳定 ref（元素由本模块持有，不由 React 渲染）。 */
export const audioSessionRef: { current: HTMLAudioElement | null } = { current: el }
export const audioSessionEl = el

interface AudioSessionState {
  /** 正在播的条目（null = 没有会话，迷你条不出现）。 */
  item: MediaItem | null
  playing: boolean
  position: number
  duration: number
  /** 播不了的直链（403/失效）——播放页与迷你条据此提示，而不是装作在播。 */
  error: string | null
  /** 打开一条音频；同一条重复调用是 no-op（播放页重挂不能把手动进度冲掉）。 */
  open: (item: MediaItem, src: string, startAtSec?: number) => void
  toggle: () => void
  close: () => void
}

export const useAudioSession = create<AudioSessionState>((set, get) => ({
  item: null,
  playing: false,
  position: 0,
  duration: 0,
  error: null,

  open(item, src, startAtSec) {
    const cur = get().item
    if (cur && cur.id === item.id && cur.subscriptionId === item.subscriptionId && el.src) return
    set({ item, position: 0, duration: 0, error: null })
    el.src = src
    // 续播：≤3s 视为「从头听」（与 PlayableMedia 同一条规则，避免片头几秒被当成续播点）。
    const at = startAtSec ?? 0
    if (at > 3) {
      const seek = () => {
        try {
          el.currentTime = at
        } catch {
          /* 未就绪时忽略 */
        }
      }
      if (el.readyState >= 1) seek()
      else el.addEventListener("loadedmetadata", seek, { once: true })
    }
    void el.play().catch(() => {
      // autoplay policy 拦下：留在暂停态，等用户按播放键（迷你条/播放页都有）。
    })
  },

  toggle() {
    if (el.paused) void el.play().catch(() => {})
    else el.pause()
  },

  close() {
    el.pause()
    el.removeAttribute("src")
    el.load()
    set({ item: null, playing: false, position: 0, duration: 0, error: null })
  },
}))

// —— 单例元素事件 → store / 续播落库（模块级只挂一次）——————————————
el.addEventListener("play", () => useAudioSession.setState({ playing: true }))
el.addEventListener("pause", () => useAudioSession.setState({ playing: false }))
el.addEventListener("error", () => {
  const code = el.error?.code
  useAudioSession.setState({ error: el.error?.message || `audio error(code=${code ?? "?"})`, playing: false })
})

// 进度：4Hz 更新给 UI（迷你条的进度条）；落库节流到 5s 一次。
let lastSaved = -1
el.addEventListener("timeupdate", () => {
  const dur = Number.isFinite(el.duration) ? el.duration : 0
  useAudioSession.setState({ position: el.currentTime, duration: dur })
  const item = useAudioSession.getState().item
  if (!item || dur <= 0) return
  if (Math.abs(el.currentTime - lastSaved) < 5) return
  lastSaved = el.currentTime
  useDesktop.getState().savePosition(item, el.currentTime, dur)
})
