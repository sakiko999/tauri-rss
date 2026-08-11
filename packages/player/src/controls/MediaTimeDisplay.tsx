/**
 * MediaTimeDisplay —— 时间显示(当前时间 / 总时长,直播显示 ●LIVE)。
 * MediaChrome `<media-time-display>` / `<media-duration-display>` 的 React 合并版。
 */
import type { VideoPlayState } from "../useVideoElement.ts"
import { formatTime } from "../time.ts"

export function MediaTimeDisplay({ state }: { state: VideoPlayState }) {
  if (state.live) {
    return <span className="shrink-0 px-1 text-xs tabular-nums text-white/85"><span className="text-red-400">● LIVE</span></span>
  }
  return (
    <span className="shrink-0 px-1 text-xs tabular-nums text-white/85">
      {formatTime(state.currentTime)}
      <span className="text-white/50"> / {formatTime(state.duration)}</span>
    </span>
  )
}
