/**
 * MediaMuteButton —— 静音切换按钮(MediaChrome `<media-mute-button>` 的 React 版)。
 *
 * 只读 `state.muted/volume`,点按调 `ops.toggleMute`。音量归零也显示静音图标。
 */

import type { VideoOps, VideoPlayState } from "../hooks/useVideoElement.ts"
import { VolumeIcon, VolumeMutedIcon } from "../icons.tsx"

export function MediaMuteButton({
  state,
  ops,
  className = "flex h-[22px] w-9 items-center justify-center text-white/80 hover:text-white",
}: {
  state: VideoPlayState
  ops: VideoOps
  className?: string
}) {
  const muted = state.muted || state.volume === 0
  return (
    <button type="button" aria-label={muted ? "取消静音" : "静音"} onClick={ops.toggleMute} className={className}>
      {muted ? <VolumeMutedIcon className="h-[22px] w-[22px]" /> : <VolumeIcon className="h-[22px] w-[22px]" />}
    </button>
  )
}
