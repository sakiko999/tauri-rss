/**
 * 减弱动效偏好 —— 需要在 **JS** 里查一次的场景。
 *
 * `styles.css` 的 `@media (prefers-reduced-motion: reduce)` 只把 CSS 的
 * animation/transition 压到 0.001ms 并关掉 `scroll-behavior`;对**脚本驱动**的
 * 动画(平滑滚动、形变转场、入场编排)完全无效 —— 那些必须在这里问一次。
 *
 * ⚠️ 引动画库后这条变得更要紧:入场/布局动画一旦跑在 JS 里,只靠媒体查询
 * 就是「设置了减动效、动画照跑」。用 Motion 时对应 `<MotionConfig reducedMotion="user">`。
 */

/** 系统是否要求减弱动效。 */
export const prefersReducedMotion = (): boolean =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false

/** `scrollIntoView` 的 behavior:跟随系统偏好降级为瞬时跳转。 */
export const scrollBehavior = (): ScrollBehavior => (prefersReducedMotion() ? "auto" : "smooth")

/**
 * 读 CSS 的 `--dur-*` 令牌(ms)。**需要「等退场动画放完再卸载」时用**。
 *
 * ⚠️ 不能在 JS 里写死时长:动效有 `data-motion="off|standard|rich"` 三档,写死会有两个
 * 坏结果 —— `off` 档下等一个已经不存在的动画(白等),`rich` 档下动画没放完就被卸载(卡顿)。
 * 读令牌则是三档自动对齐,且将来改令牌不用回来改这里。
 */
export function motionDurationMs(level: "fast" | "base" | "slow"): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--dur-${level}`).trim()
  const n = Number.parseFloat(raw)
  // 兜底值取 `--dur-*` 的标准档(:root 里的 120/180/260ms),仅当 CSS 还没加载时命中。
  if (!Number.isFinite(n)) return { fast: 120, base: 180, slow: 260 }[level]
  return raw.endsWith("ms") ? n : n * 1000
}
