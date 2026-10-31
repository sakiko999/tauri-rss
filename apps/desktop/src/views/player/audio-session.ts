/**
 * AudioSession —— 播客单集的**会话级**播放器（跨路由存活）。
 *
 * 为什么要在路由之外：播放页一卸载，页面里的 `<audio>` 就跟着销毁。「离开播放页继续
 * 听」正是原型迷你条的语义。这里用一个模块级单例 `<audio>`（挂在 body 上）持有播放，
 * 播放页与迷你条都只是它的两个控制面。
 *
 * ⚠️ 只承担**渐进式音频**（播客单集：mp3/m4a/aac/ogg）。视频/直播（含听视频的 DASH
 * 音轨）归 `video-session.ts` 的视频会话 —— 那边常驻的是整条 PlayableMedia 栈。
 * 播完自动下一条在 `session-queue.ts` 统一（两会话共用，含浮层态）。
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
  /** 打开时的返回位置（自动下一条导航用；迷你条回页用缺省 selectedNodeId）。 */
  from: string | null
  playing: boolean
  position: number
  duration: number
  /** 播不了的直链（403/失效）——播放页与迷你条据此提示，而不是装作在播。 */
  error: string | null
  /** 打开一条音频；同一条重复调用是 no-op（播放页重挂不能把手动进度冲掉）。 */
  open: (item: MediaItem, src: string, startAtSec?: number, from?: string | null) => void
  toggle: () => void
  close: () => void
}

export const useAudioSession = create<AudioSessionState>((set, get) => ({
  item: null,
  from: null,
  playing: false,
  position: 0,
  duration: 0,
  error: null,

  open(item, src, startAtSec, from) {
    const cur = get().item
    if (cur && cur.id === item.id && cur.subscriptionId === item.subscriptionId && el.src) return
    set({ item, from: from ?? null, position: 0, duration: 0, error: null })
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
    set({ item: null, from: null, playing: false, position: 0, duration: 0, error: null })
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

// —— 播完自动下一条：由 session-queue 注入（本模块不 import 它，避免循环）————
// 迷你条状态下（不在播放页）这里也是唯一监听 —— 正是旧实现「切走后连播失效」的缺口。
let endedHandler: ((item: MediaItem) => void) | null = null
export function setAudioSessionEndedHandler(fn: ((item: MediaItem) => void) | null) {
  endedHandler = fn
}
el.addEventListener("ended", () => {
  const item = useAudioSession.getState().item
  if (item) endedHandler?.(item)
})

// —— 互斥：本路起播时先停另一路（视频会话），回调由 session-queue 注入避免循环 ————
let playInterceptor: (() => void) | null = null
export function setAudioPlayInterceptor(fn: (() => void) | null) {
  playInterceptor = fn
}
el.addEventListener("play", () => playInterceptor?.())

// —— 「正在播放页显示」状态（session-queue 据此决定播完是导航还是会话内换条）——
let audioOnStage = false
export function setAudioOnStage(on: boolean) {
  audioOnStage = on
}
export function isAudioOnStage(): boolean {
  return audioOnStage
}
