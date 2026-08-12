/**
 * attemptPlayWithMuteFallback —— 带声起播 + 被拦降级静音(四格式共用)。
 *
 * 四格式(mp4/hls/flv/dash)起播的「带声 play → 被 autoplay policy 拦 → 静音重试」
 * 逻辑原本逐字重复四次,抽到这里统一:
 *
 *   attemptPlay(video, play)
 *     ├─ play() 成功 → 带声
 *     └─ play() reject
 *         ├─ AbortError(媒体未就绪/中断,非 policy 拦截)→ 不降级,等就绪事件重试
 *         └─ NotAllowedError 等(policy 拦截)
 *             ├─ autoPlay && 未静音 → muted=true + 静音重试(静音 autoplay 恒允许)
 *             └─ 否则 → onFail 上报
 *
 * ⚠️ 关键坑:AbortError ≠ 被拦。src 刚设/分段未就绪时 play() 以 AbortError reject,
 * 不能当 policy 拦截处理(否则带声起播会误降级静音,YouTube video 静音即因此)。
 * 区分依据:policy 拦截是 NotAllowedError,媒体未就绪是 AbortError。
 */
export function attemptPlayWithMuteFallback(
  video: HTMLVideoElement,
  play: () => Promise<void> | void,
  opts: { autoPlay: boolean; onFail?: (e: unknown) => void },
): void {
  const p = play()
  if (!p || typeof p.catch !== "function") return
  p.catch((e: unknown) => {
    const name = (e as { name?: string })?.name
    // 媒体未就绪/中断:非 policy 拦截,不静音——等 canplay/就绪事件再试。
    if (name === "AbortError") return
    if (opts.autoPlay && !video.muted && video.isConnected) {
      video.muted = true
      const retry = play()
      if (retry && typeof retry.catch === "function") retry.catch(() => {})
      return
    }
    opts.onFail?.(e)
  })
}
