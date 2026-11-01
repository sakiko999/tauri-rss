/**
 * MediaFullscreenButton —— 全屏切换按钮(MediaChrome `<media-fullscreen-button>` 的 React 版)。
 *
 * 只读 `fullscreen.isFullscreen`,点按调 `fullscreen.toggle`。
 */

import type { FullscreenApi } from "../hooks/useVideoElement.ts"
import { FullscreenExitIcon, FullscreenIcon } from "../icons.tsx"

export function MediaFullscreenButton({
  fullscreen,
  className = "flex h-[22px] w-9 items-center justify-center text-white/80 hover:text-white",
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
        <FullscreenExitIcon className="h-[22px] w-[22px]" />
      ) : (
        <FullscreenIcon className="h-[22px] w-[22px]" />
      )}
    </button>
  )
}
