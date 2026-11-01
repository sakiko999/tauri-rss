/**
 * MediaLiveEdgeButton —— 直播「回到直播」按钮(离边缘超过阈值时显示)。
 * MediaChrome `<media-live-button>` 的 React 版。
 *
 * 只订阅「距缓冲边缘的秒数」这一原始值 → 离边缘时出现、回到边缘时消失,
 * 不把 4Hz 的 currentTime 带进 React 树。
 */

import type { MediaClock } from "../hooks/mediaClock.ts"
import { useMediaTime } from "../hooks/mediaClock.ts"
import type { VideoOps, VideoPlayState } from "../hooks/useVideoElement.ts"

/** 距直播边缘超过 5s 判定为「离开直播」,显示回直播按钮。 */
export const LIVE_EDGE_THRESHOLD_S = 5

export function MediaLiveEdgeButton({
  state,
  ops,
  clock,
}: {
  state: VideoPlayState
  ops: VideoOps
  clock: MediaClock
}) {
  const behind = useMediaTime(clock, (s) => s.bufferedEnd - s.currentTime, 0)
  if (!state.live || state.paused) return null
  if (behind <= LIVE_EDGE_THRESHOLD_S) return null
  return (
    <button
      type="button"
      onClick={ops.setLiveEdge}
      className="shrink-0 rounded border border-white/30 px-1.5 py-0.5 text-[10px] tracking-wide uppercase hover:bg-white/20"
    >
      回直播
    </button>
  )
}
