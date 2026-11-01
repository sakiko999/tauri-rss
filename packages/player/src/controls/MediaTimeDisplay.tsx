/**
 * MediaTimeDisplay —— 时间显示(对齐 B 站控件栏)。
 *
 *   - 点播:`01:00 / 02:10`(补零;`/` 降一档亮度);
 *   - 直播:仅已播时长 `407:26:23`(补零 hh:mm:ss,无 LIVE 胶囊 —— B 站直播
 *     控件栏就是这样显示的,「直播中」标识属于页面信息,不是播放器 chrome)。
 *
 * `mode` 由控件栏显式给(宿主知道条目 kind);不给时回退到运行时判定。
 */

import type { VideoPlayState } from "../hooks/useVideoElement.ts"
import { formatTime } from "../utils/time.ts"

export function MediaTimeDisplay({
  state,
  mode,
  className = "shrink-0 px-1.5 text-xs text-white/80 tabular-nums",
}: {
  state: VideoPlayState
  mode?: "video" | "live"
  className?: string
}) {
  const live = mode === "live" || (mode === undefined && state.live)
  if (live) {
    return <span className={className}>{formatTime(state.currentTime)}</span>
  }
  return (
    <span className={className}>
      {formatTime(state.currentTime)}
      <span className="text-white/50"> / {formatTime(state.duration)}</span>
    </span>
  )
}
