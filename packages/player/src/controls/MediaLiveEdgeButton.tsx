/**
 * MediaLiveEdgeButton —— 直播「回到直播」按钮(离边缘超过阈值时显示)。
 * MediaChrome `<media-live-button>` 的 React 版。
 */
import type { VideoOps, VideoPlayState } from "../useVideoElement.ts"

/** 距直播边缘超过 5s 判定为「离开直播」,显示回直播按钮。 */
export const LIVE_EDGE_THRESHOLD_S = 5

export function MediaLiveEdgeButton({
  state,
  ops,
}: {
  state: VideoPlayState
  ops: VideoOps
}) {
  if (!state.live || state.paused) return null
  if (!(state.bufferedEnd > 0 && state.bufferedEnd - state.currentTime > LIVE_EDGE_THRESHOLD_S)) return null
  return (
    <button
      type="button"
      onClick={ops.setLiveEdge}
      className="shrink-0 rounded border border-white/30 px-1.5 py-0.5 text-[10px] uppercase tracking-wide hover:bg-white/20"
    >
      回直播
    </button>
  )
}
