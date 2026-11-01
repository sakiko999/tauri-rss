/**
 * mediaClock —— 播放时间的**外部状态**(P0b-1:取消 4Hz 全树重渲)。
 *
 * timeupdate 以 ~4Hz 触发;把它写进 React state 会让 VideoShell 整棵树(控件栏、
 * 浮层、菜单)每秒重渲 4 次。这里把**热字段**(currentTime / bufferedEnd)搬出
 * React:事件直接写本 store 并通知订阅者,只有真正消费时间的叶子组件用
 * `useMediaTime` 按 selector 订阅(且 selector 返回**原始值**,让 React 只在值变化时
 * 重渲 —— 例如时间文本按秒粒度,每秒一次)。
 *
 * 冷字段(paused/volume/rate/waiting/live…)仍在 `useVideoElement` 的 React state。
 *
 * ⚠️ `state` 是**原地可变对象**;`useMediaTime` 的 selector 必须返回原始值(数字/
 * 字符串/布尔),返回新对象会让 `useSyncExternalStore` 每次快照不同 → 死循环。
 */

import { useSyncExternalStore } from "react"

export interface MediaClockState {
  currentTime: number
  /** 已缓冲区间的最远点(直播 = 可跳转的最远点)。 */
  bufferedEnd: number
}

export interface MediaClock {
  /** 原地更新的快照对象(只读使用;写只经 `update`)。 */
  readonly state: MediaClockState
  subscribe(cb: () => void): () => void
  update(currentTime: number, bufferedEnd: number): void
}

export function createMediaClock(): MediaClock {
  const state: MediaClockState = { currentTime: 0, bufferedEnd: 0 }
  const subs = new Set<() => void>()
  return {
    state,
    subscribe(cb) {
      subs.add(cb)
      return () => {
        subs.delete(cb)
      }
    },
    update(currentTime, bufferedEnd) {
      if (state.currentTime === currentTime && state.bufferedEnd === bufferedEnd) return
      state.currentTime = currentTime
      state.bufferedEnd = bufferedEnd
      for (const cb of subs) cb()
    },
  }
}

const NOOP_SUBSCRIBE = (_cb: () => void) => () => {}

/**
 * 订阅时钟的一个切片。`fallback` 用于 clock 尚未就绪(首帧)。
 * ⚠️ selector 必须是纯函数且返回原始值。
 */
export function useMediaTime<T>(
  clock: MediaClock | null | undefined,
  selector: (s: MediaClockState) => T,
  fallback: T,
): T {
  return useSyncExternalStore(
    clock ? clock.subscribe : NOOP_SUBSCRIBE,
    () => (clock ? selector(clock.state) : fallback),
    () => fallback,
  )
}
