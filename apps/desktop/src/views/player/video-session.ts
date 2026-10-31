/**
 * VideoSession —— 视频/直播（含听视频）的**会话级**播放器（跨路由存活）。
 *
 * 与 `audio-session.ts` 同构：媒体宿主不在 React 树里，路由切走播放不中断。
 * 差异在视频不是「一个元素」就够 —— 解析/引擎(hls/dash/flv)/弹幕/控件是一整条
 * 栈，所以常驻的是一个 **host div**：`VideoSessionStage`（App 层）用
 * `createPortal` 把 `PlayableMedia` 渲染进 host（React 只管内容），host 的
 * **父容器**由本模块命令式 `moveHost` 在「播放页插槽 ↔ 右下小窗 ↔ 隐藏 home」
 * 之间 `appendChild` 移动 —— 同文档移动 DOM 不中断 MSE 播放，引擎零感知。
 *
 * ⚠️ 纪律：host 永远不由 React 直接渲染（否则父链 reconcile 会把节点搬走/删除）；
 * 所有移动必须走 `moveHost`（幂等 + 全屏守卫）；slot 注册必须用 `useLayoutEffect`
 * （passive cleanup 晚于 DOM 移除，会把 host 带进死树）。
 */

import type { MediaItem, PlaybackChapter } from "@amoeba/core"
import { create } from "zustand"

import { itemKey } from "../../lib/media.ts"
import { audioSessionEl } from "./audio-session.ts"

/** 常驻宿主：React 树外的 div，`VideoSessionStage` 经 createPortal 渲染其内容。 */
export const host = document.createElement("div")
host.className = "video-session-host"

/** host 的三个归宿：播放页插槽（动态注册）/ 小窗画面区 / 隐藏 home（默认）。 */
let slot: { el: HTMLElement; key: string } | null = null
let miniEl: HTMLElement | null = null
let homeEl: HTMLElement | null = null

/** 播放器回报的媒体控制句柄（PlayableMedia onMediaControl 的载荷）。 */
export interface VideoCtl {
  seek: (sec: number) => void
  togglePlay: () => void
  pause: () => void
  toggleMute: () => void
}

interface VideoSessionState {
  /** 会话条目（video/live；听视频也是 video）。null = 无会话，Stage 卸载 portal。 */
  item: MediaItem | null
  mode: "view" | "listen"
  /** 返回位置（回播放页时带上；对齐播放页 ?from=）。 */
  from: string | null
  /** 打开会话时的续播点快照（重进播放页不重置，防冲掉手动进度）。 */
  startAtSec: number | undefined
  playing: boolean
  /** 起播过至少一次 —— 浮层（小窗/听条）的显示判据：没播过的会话不飘占位。 */
  started: boolean
  /**
   * 当前**注册在播放页舞台**的条目键（`itemKey`）。null = 没有页面插槽。
   * 浮层判据必须用它而不是 URL 的 itemId：条目被刷新移出镜像后 PlayerPage 会早退、
   * 不渲染插槽，但 URL 仍指着它 —— 那时必须落回小窗，否则播放器被藏进隐藏 home。
   */
  stageKey: string | null
  /** 4Hz 进度，供听条进度条（画面模式没人订阅，无渲染成本）。 */
  position: number
  duration: number
  /** 静音态（小窗静音按钮的显示）。 */
  muted: boolean
  /** 播放器回报的「实际纯音频」（带条目键，切条目自动失效）。 */
  audioOnly: { key: string; on: boolean } | null
  chapters: { key: string; list: PlaybackChapter[] } | null
  /** 当前章节下标（onProgress 顺带算，只在跨章节时 setState）。 */
  chapterIdx: number
  ctl: VideoCtl | null
  /** 打开一条视频会话；同条目幂等（只补 mode/from，不动 startAtSec）。 */
  open: (item: MediaItem, opts: { from?: string | null; mode?: "view" | "listen"; startAtSec?: number }) => void
  /** 停止并销毁会话（Stage 卸载 portal → PlayableMedia 卸载 → 引擎 destroy）。 */
  close: () => void
}

export const useVideoSession = create<VideoSessionState>((set, get) => ({
  item: null,
  mode: "view",
  from: null,
  startAtSec: undefined,
  playing: false,
  started: false,
  stageKey: null,
  position: 0,
  duration: 0,
  muted: false,
  audioOnly: null,
  chapters: null,
  chapterIdx: -1,
  ctl: null,

  open(item, opts) {
    // 互斥：两路声音不许叠（音频会话保留，只是暂停，迷你条可随时续上）。
    audioSessionEl.pause()
    const cur = get().item
    if (cur && itemKey(cur) === itemKey(item)) {
      // 同条目：播放页重挂/听⇄看 —— 只补参数，绝不动 startAtSec（手动进度不能被冲掉）。
      set({ mode: opts.mode ?? get().mode, from: opts.from ?? get().from })
      return
    }
    set({
      item,
      mode: opts.mode ?? "view",
      from: opts.from ?? null,
      startAtSec: opts.startAtSec,
      playing: false,
      started: false,
      position: 0,
      duration: 0,
      muted: false,
      audioOnly: null,
      chapters: null,
      chapterIdx: -1,
      ctl: null,
    })
  },

  close() {
    // 不清 host 内容 —— item=null 让 Stage 卸载 portal，PlayableMedia 的卸载兜底
    // effect 负责 destroy 引擎/revokeObjectURL（useMediaStream 的设计如此）。
    set({
      item: null,
      playing: false,
      started: false,
      position: 0,
      duration: 0,
      muted: false,
      audioOnly: null,
      chapters: null,
      chapterIdx: -1,
      ctl: null,
    })
  },
}))

// —— host 归属（单一入口，幂等）—————————————————————————————————

function moveHost(target: HTMLElement | null) {
  if (!target) return
  if (host.parentElement === target) return
  // 移动正处全屏的子树行为不确定（部分实现强退、部分黑屏）：先明确退出。
  if (document.fullscreenElement && host.contains(document.fullscreenElement)) {
    void document.exitFullscreen()
  }
  target.appendChild(host)
}

/** 计算当前归属并移动 host。任何归宿/会话状态变化后都要调它收敛一次。 */
export function applyVideoPlacement() {
  const s = useVideoSession.getState()
  const key = s.item ? itemKey(s.item) : null
  // 1) 播放页显示本会话条目 → 插槽（页面态：舞台 + 完整控件）。
  if (slot && key && slot.key === key) {
    moveHost(slot.el)
    return
  }
  // 2) 浮层态：画面模式进小窗；听模式 host 藏 home（<audio> 不受 display:none 影响）。
  if (s.item && s.started) {
    moveHost(s.audioOnly?.on ? (homeEl ?? miniEl) : (miniEl ?? homeEl))
    return
  }
  // 3) 无会话 / 从未起播 → home。
  moveHost(homeEl)
}

/** 播放页舞台插槽注册（VideoStageSlot 的 useLayoutEffect 里调）。 */
export function registerSlot(el: HTMLElement, key: string) {
  cancelIdleClose()
  slot = { el, key }
  useVideoSession.setState({ stageKey: key })
  applyVideoPlacement()
}

export function unregisterSlot() {
  slot = null
  useVideoSession.setState({ stageKey: null })
  applyVideoPlacement()
  // 离页时从未起播的会话（关了自动播放停在「准备播放」）不该一直挂在 home：
  // 延迟收口 —— StrictMode 的模拟卸载会在同一帧内重新注册从而取消本次关闭。
  scheduleIdleClose()
}

/** 消费方（session-queue）判断「当前条目是否正显示在播放页舞台上」。 */
export function isVideoOnStage(key: string): boolean {
  return slot?.key === key
}

// —— Stage 容器注册（ref 回调）———————————————————————————————

export function setHomeContainer(el: HTMLElement | null) {
  homeEl = el
  applyVideoPlacement()
}

export function setMiniContainer(el: HTMLElement | null) {
  miniEl = el
  applyVideoPlacement()
}

// —— 未起播会话的延迟收口 ————————————————————————————————————

let closeTimer: number | null = null

function scheduleIdleClose() {
  if (closeTimer !== null) return
  closeTimer = window.setTimeout(() => {
    closeTimer = null
    const s = useVideoSession.getState()
    if (s.item && !s.started && !slot) s.close()
  }, 3000)
}

function cancelIdleClose() {
  if (closeTimer !== null) {
    window.clearTimeout(closeTimer)
    closeTimer = null
  }
}

// —— host 上的媒体事件 → store（捕获阶段：媒体事件不冒泡）——————————
// 挂在 host 而不是具体元素：听⇄看会换 <audio>/<video>，host 永不变。
host.addEventListener(
  "play",
  () => {
    // 互斥（对称）：本路起播先停播客（open 时的 pause 只覆盖「新开会话」，
    // 小窗/迷你条的恢复播放走这里 —— 两路声音永不叠加）。
    audioSessionEl.pause()
    useVideoSession.setState({ playing: true, started: true })
  },
  true,
)
host.addEventListener("pause", () => useVideoSession.setState({ playing: false }), true)
host.addEventListener("volumechange", () => useVideoSession.setState({ muted: elMuted() }), true)

/** 当前承载元素的静音态（听⇄看会换元素，每次现读）。 */
function elMuted(): boolean {
  const media = host.querySelector("video, audio")
  return media instanceof HTMLMediaElement ? media.muted : false
}
