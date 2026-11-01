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
  className = "flex h-[22px] w-9 items-center justify-center text-white/80 hover:text-white",
}: {
  state: VideoPlayState
  ops: VideoOps
  className?: string
}) {
  return (
    <button type="button" aria-label={state.paused ? "播放" : "暂停"} onClick={ops.togglePlay} className={className}>
      {state.paused ? <PlayIcon className="h-[22px] w-[22px]" /> : <PauseIcon className="h-[22px] w-[22px]" />}
    </button>
  )
}
