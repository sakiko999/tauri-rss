/**
 * MediaMuteButton —— 静音切换按钮(MediaChrome `<media-mute-button>` 的 React 版)。
 *
 * 只读 `state.muted/volume`,点按调 `ops.toggleMute`。音量归零也显示静音图标。
 */
import type { VideoOps, VideoPlayState } from "../useVideoElement.ts"
import { VolumeIcon, VolumeMutedIcon } from "../icons.tsx"

export function MediaMuteButton({
  state,
  ops,
  className = "rounded p-1 hover:bg-white/20",
}: {
  state: VideoPlayState
  ops: VideoOps
  className?: string
}) {
  const muted = state.muted || state.volume === 0
  return (
    <button
      type="button"
      aria-label={muted ? "取消静音" : "静音"}
      onClick={ops.toggleMute}
      className={className}
    >
      {muted ? <VolumeMutedIcon className="h-5 w-5" /> : <VolumeIcon className="h-5 w-5" />}
    </button>
  )
}
