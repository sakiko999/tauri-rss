/**
 * MediaFullscreenButton —— 全屏切换按钮(MediaChrome `<media-fullscreen-button>` 的 React 版)。
 *
 * 只读 `fullscreen.isFullscreen`,点按调 `fullscreen.toggle`。
 */
import type { FullscreenApi } from "../hooks/useVideoElement.ts"
import { FullscreenExitIcon, FullscreenIcon } from "../icons.tsx"

export function MediaFullscreenButton({
  fullscreen,
  className = "rounded p-1 hover:bg-white/20",
}: {
  fullscreen: FullscreenApi
  className?: string
}) {
  return (
    <button
      type="button"
      aria-label={fullscreen.isFullscreen ? "退出全屏" : "全屏"}
      onClick={fullscreen.toggle}
      className={className}
    >
      {fullscreen.isFullscreen ? (
        <FullscreenExitIcon className="h-5 w-5" />
      ) : (
        <FullscreenIcon className="h-5 w-5" />
      )}
    </button>
  )
}
