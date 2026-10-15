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
