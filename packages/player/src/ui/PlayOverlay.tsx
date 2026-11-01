/**
 * PlayOverlay —— 画面中央的播放按钮(未起播的大按钮 / 暂停时的悬停按钮)。
 *
 * 从 VideoShell 内联 JSX 抽出(P0a-1):大播放键是**播放器级**浮层,后续的
 * 片尾面板、OSD、错误态都挂在同层;单独成件后 VideoShell 只组合不堆细节。
 */

import { PlayIcon } from "../icons.tsx"

export function PlayOverlay({ variant, onPlay }: { variant: "big" | "paused"; onPlay: () => void }) {
  const big = variant === "big"
  return (
    <button
      type="button"
      aria-label={big ? "播放" : "继续播放"}
      onClick={(e) => {
        e.stopPropagation()
        onPlay()
      }}
      className={
        big
          ? "absolute inset-0 m-auto flex h-16 w-16 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur transition hover:bg-white/30"
          : "absolute inset-0 m-auto flex h-16 w-16 items-center justify-center rounded-full bg-black/40 text-white opacity-0 backdrop-blur transition group-hover:opacity-100 hover:bg-black/60"
      }
    >
      <PlayIcon className="h-8 w-8 translate-x-0.5" />
    </button>
  )
}
