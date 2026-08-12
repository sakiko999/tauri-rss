/**
 * MediaPlayButton —— 播放/暂停按钮(MediaChrome `<media-play-button>` 的 React 版)。
 *
 * 独立可组合:只读 `state.paused`,点按调 `ops.togglePlay`。自带 aria-label。
 */
import type { VideoOps, VideoPlayState } from "../hooks/useVideoElement.ts"
import { PauseIcon, PlayIcon } from "../icons.tsx"

export function MediaPlayButton({
  state,
  ops,
  className = "rounded p-1 hover:bg-white/20",
}: {
  state: VideoPlayState
  ops: VideoOps
  className?: string
}) {
  return (
    <button
      type="button"
      aria-label={state.paused ? "播放" : "暂停"}
      onClick={ops.togglePlay}
      className={className}
    >
      {state.paused ? <PlayIcon className="h-5 w-5" /> : <PauseIcon className="h-5 w-5" />}
    </button>
  )
}
