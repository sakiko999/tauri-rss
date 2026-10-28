/**
 * 纯 UI 动作:离线开关、命令面板、播放队列、弹幕临时开关、toast。
 *
 * 从 store/index.ts 拆出;只依赖 StoreCtx + lib 的队列持久化。
 */

import { itemKey } from "../../lib/media.ts"
import { saveQueue } from "../lib.ts"
import type { DesktopState, StoreCtx } from "../types.ts"

type UiActions = Pick<
  DesktopState,
  | "setOffline"
  | "setPaletteOpen"
  | "addToQueue"
  | "removeFromQueue"
  | "clearQueue"
  | "toggleDanmaku"
  | "toast"
  | "dismissToast"
  | "removeToast"
>

let toastSeq = 0

export function createUiActions(ctx: StoreCtx): UiActions {
  const { set, get } = ctx

  return {
    setOffline(v) {
      set({ offline: v })
      get().toast(v ? "warn" : "ok", v ? "已切到离线模式" : "已恢复在线", v ? "刷新会被跳过,只读本地缓存。" : undefined)
    },

    setPaletteOpen(open) {
      set({ paletteOpen: open })
    },

    addToQueue(item) {
      // ⚠️ 社交条目没有可播流,进了队列后点它/「下一条」都会跳到解析失败的播放页。
      // 收口在入队处,比在每个队列行上加判断更彻底(详情弹窗也会调这里)。
      if (item.kind === "social") {
        get().toast("warn", "社交内容不支持播放队列", "点开卡片可以看详情。")
        return
      }
      // 存 `subId:itemId` —— 只存 item.id 会让跨订阅同 id 的条目互相顶掉。
      const key = itemKey(item)
      set((s) => {
        if (s.queue.includes(key)) return s
        const next = [...s.queue, key]
        saveQueue(next)
        return { queue: next }
      })
    },

    removeFromQueue(item) {
      const key = itemKey(item)
      set((s) => {
        const next = s.queue.filter((k) => k !== key)
        saveQueue(next)
        return { queue: next }
      })
    },

    clearQueue() {
      saveQueue([])
      set({ queue: [] })
    },

    toggleDanmaku() {
      set((s) => ({ danmakuVisible: !s.danmakuVisible }))
    },

    toast(tone, title, text, action) {
      const id = ++toastSeq
      set((s) => ({ toasts: [...s.toasts, { id, tone, title, text, ...(action ? { action } : {}) }] }))
      // 带动作的吐司给更长的阅读/点击时间(4.2s 来不及看清「撤销」就被收走)。
      setTimeout(() => get().dismissToast(id), action ? 8000 : 4200)
    },

    dismissToast(id) {
      // ⚠️ 只打标记**不删** —— 删了元素当场卸载,退场动画没机会播。真正移除在
      // removeToast,由 Toaster 在动画结束后调。
      set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, closing: true } : t)) }))
    },

    removeToast(id) {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    },
  }
}
