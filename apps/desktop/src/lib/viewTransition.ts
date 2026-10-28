/**
 * 社交详情「缩略图 → 全屏」的共享元素形变 —— 原生 `document.startViewTransition`。
 *
 * 实测(CDP + 真实 Chromium 155):`startViewTransition` 可用,故**不引 motion**(省 ~35KB)。
 * 内核不支持 / 用户开了「减少动效」时,直接降级为瞬时打开 —— 降级路径必须与原来**完全一致**,
 * 否则就从一个「锦上添花」变成一个「新 bug」。
 *
 * ⚠️ 三个坑**都会静默失败**(不报错、看着像「没生效」),所以写细:
 *   1. **同名即整段失效** —— 新状态里源元素若仍与目标同名,浏览器判定重复,直接忽略
 *      整个过渡。卡片**没被卸载**(弹窗是叠加层,瀑布流还在底下),所以回调里必须
 *      **先把源的 name 摘掉**,再挂目标。
 *   2. **必须 `flushSync`** —— React 的 setState 是异步的。不同步刷 DOM 的话,浏览器
 *      捕获「新状态」时弹窗还没渲染,**目标元素不存在** → 没有形变。
 *   3. **别和入场动画叠** —— `.modal` 有 `modal-in`(scale),VT 自己在做形变,两者同跑会抖。
 *      过渡期间把它停掉。
 */

import { flushSync } from "react-dom"

import { prefersReducedMotion } from "./motion.ts"

/** VT 名字。**全页唯一** —— 重名会让浏览器静默忽略整个过渡。 */
const VT_NAME = "social-cover"

/** 点击时记下的源缩略图。 */
let pendingSource: HTMLElement | null = null

/** 卡片点击时调用:记住「从哪张图开始形变」。传 null / 不调 = 走瞬时打开。 */
export function rememberSocialSource(el: HTMLElement | null): void {
  pendingSource = el
}

const clearName = (el: HTMLElement | null): void => {
  if (el) el.style.viewTransitionName = ""
}

/**
 * 打开社交详情。能形变就走 View Transition,否则直接调 `open()`。
 * ⚠️ `open` 必须**同步**触发弹窗渲染(store 的 `openSocialDetail` 满足 —— 它同步 `set`)。
 */
export function openSocialDetailWithTransition(open: () => void): void {
  const source = pendingSource
  pendingSource = null

  // ⚠️ `isConnected`:卡片可能已被虚拟化卸载(点完立刻滚走),name 挂上去也抓不到快照。
  if (!source || !source.isConnected || typeof document.startViewTransition !== "function" || prefersReducedMotion()) {
    open()
    return
  }

  source.style.viewTransitionName = VT_NAME

  const vt = document.startViewTransition(() => {
    // 坑 1:源在新状态里必须摘掉 name(否则与目标重复 → 整段过渡被忽略)。
    clearName(source)
    // 坑 2:同步刷 DOM,否则下面查不到目标。
    flushSync(open)
    // 目标的 name 由 CSS 的 `.social-detail-cover` 常驻声明,**不在这里挂** ——
    // 见该类的注释:挂在这里的话过渡结束时会把它清掉,下一张图就没形变了。
    // 坑 3:过渡期间停掉**入场动画**。
    // ⚠️ `.scrim` 也有一条 `fade`(遮罩淡入)。它在 VT 的**快照**里会被截在 opacity≈0,
    // 过渡一结束真身立刻显示 → 一帧闪烁。所以两处都要停。
    for (const sel of [".modal", ".scrim"]) {
      const el = document.querySelector<HTMLElement>(sel)
      if (el) el.style.animation = "none"
    }
  })

  void vt.finished.finally(() => {
    clearName(source)
    // ⚠️ **不要**把 animation 还原成 CSS 值 —— 那会把 `modal-in` / `fade` **重新挂回去
    // 并从头再播一遍**(过渡刚结束弹窗又缩一下 = 用户看到的闪烁)。显式写 none 保持
    // 与过渡期间一致:弹窗这次是被形变「带出来」的,本就不该再播入场。
    // 关闭后重开会重挂组件,动画自然恢复。
    for (const sel of [".modal", ".scrim"]) {
      const el = document.querySelector<HTMLElement>(sel)
      if (el) el.style.animation = "none"
    }
  })
}
