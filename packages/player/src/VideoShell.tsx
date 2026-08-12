/**
 * VideoShell —— 播放器外壳:视频画面 + 控件层。
 *
 * 布局:外层 relative 容器 + `<video>` 填满;控件层 absolute 铺底。纯黑底。
 * 交互/显隐逻辑收敛到三个 hook,本组件只做组合 + JSX:
 *   - useAutoHideControls  控件自动隐藏 + 缓冲 spinner
 *   - useContainerInteractions  键盘快捷键 + 点击聚焦 + 单击播放/双击全屏
 *   - useVideoElement       媒体状态 + 操作
 */
import { useEffect, useRef, useState } from "react"
import { bindFullscreen, type FullscreenApi, useVideoElement } from "./hooks/useVideoElement.ts"
import { useAutoHideControls } from "./hooks/useAutoHideControls.ts"
import { useContainerInteractions } from "./hooks/useContainerInteractions.ts"
import { PlayerControls } from "./PlayerControls.tsx"
import { PlayIcon, SpinnerIcon } from "./icons.tsx"

export function VideoShell({
  videoRef,
  isStreaming,
  className,
  src,
  autoPlay = false,
  qualityOptions,
  activeQuality,
  onQuality,
  title,
  fill = false,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>
  /** 是否由 useMediaStream(hls/flv/dash)驱动(决定直播判定)。 */
  isStreaming: boolean
  className?: string
  /** 原生渐进式视频的 src(streamed 由 MSE 库管理,不传)。 */
  src?: string
  /** 自动起播:起播瞬间不闪大播放键。 */
  autoPlay?: boolean
  qualityOptions: { rate: number; quality: string }[]
  activeQuality?: number
  onQuality: (rate: number) => void
  /** 悬停提示(如 referer 提示),挂容器 title。 */
  title?: string
  /** 填满父容器(父已定比例)。true 时不自撑比例,避免双算首帧塌缩。 */
  fill?: boolean
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const { state, ops } = useVideoElement(videoRef, isStreaming)
  const { showControls, showSpinner, poke, hide, hover, leave } = useAutoHideControls(state)
  const [fullscreenState, setFullscreenState] = useState<FullscreenApi>({
    isFullscreen: false,
    toggle: () => {},
  })
  const { handleClick } = useContainerInteractions(containerRef, state, ops, fullscreenState.toggle)

  // 原生 mp4:手动把 src 写进 <video>(React 不管理该属性,避免卸载重挂)。
  useEffect(() => {
    const el = videoRef.current
    if (!src || !el) return
    el.src = src
  }, [src, videoRef])

  // 全屏绑定:容器请求全屏,fullscreenchange 同步 state。
  useEffect(() => {
    const unsub = bindFullscreen(containerRef, setFullscreenState)
    return () => {
      unsub()
      setFullscreenState((prev) => ({ ...prev, isFullscreen: false }))
    }
  }, [])

  // 未起播 → 大播放键(autoPlay 起播瞬间不闪);播放中暂停 → 悬停播放键。
  const showBigPlay = !autoPlay && state.paused && !state.ended && !state.waiting && state.currentTime === 0
  const showPausedOverlay = state.paused && !showBigPlay && !state.ended

  // ⚠️ video 只填容器(比例由容器管):给 video 加 aspect-ratio 会与 h-full/w-full
  // 冲突,加载中塌成窄黑条。故比例全靠容器撑。
  const mediaClass = ["h-full", "w-full", "object-contain"].filter(Boolean).join(" ")
  const isFullscreen = fullscreenState.isFullscreen

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onMouseMove={poke}
      onMouseLeave={hide}
      onClick={handleClick}
      onDoubleClick={(e) => {
        e.preventDefault()
        fullscreenState.toggle()
      }}
      className={[
        "group flex items-center justify-center overflow-hidden bg-black outline-none",
        // fill(父已定比例):absolute 填满最近 relative 祖先——不能用 h-full(父链无高度
        // 约束会塌 0)。自撑:relative w-full,靠 padding-top 撑 16:9。
        isFullscreen ? "h-full w-full relative" : fill ? "absolute inset-0" : "relative w-full rounded",
        className,
      ].join(" ")}
      // 非全屏且非 fill:padding-top 撑开 16:9(video 未初始化也必然有高度)。
      style={isFullscreen || fill ? undefined : { paddingTop: "56.25%" }}
      title={title}
    >
      {/* video absolute 填满容器:自撑时 padding-top 后内容区高为 0,必须 absolute。 */}
      <video
        ref={videoRef}
        className={["absolute inset-0", mediaClass].filter(Boolean).join(" ")}
        playsInline
        preload="auto"
      />

      {showSpinner && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
          <SpinnerIcon className="h-12 w-12 animate-spin text-white/80" />
        </div>
      )}

      {showBigPlay && (
        <button
          type="button"
          aria-label="播放"
          onClick={(e) => {
            e.stopPropagation()
            ops.togglePlay()
          }}
          className="absolute inset-0 m-auto flex h-16 w-16 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur transition hover:bg-white/30"
        >
          <PlayIcon className="h-8 w-8 translate-x-0.5" />
        </button>
      )}

      {showPausedOverlay && (
        <button
          type="button"
          aria-label="继续播放"
          onClick={(e) => {
            e.stopPropagation()
            ops.togglePlay()
          }}
          className="absolute inset-0 m-auto flex h-16 w-16 items-center justify-center rounded-full bg-black/40 text-white opacity-0 backdrop-blur transition hover:bg-black/60 group-hover:opacity-100"
        >
          <PlayIcon className="h-8 w-8 translate-x-0.5" />
        </button>
      )}

      {/* 控件层(自动隐藏) */}
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 transition-opacity duration-300 ${
          showControls ? "opacity-100" : "opacity-0"
        }`}
      >
        <div
          className="pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
          onMouseEnter={hover}
          onMouseLeave={leave}
        >
          <PlayerControls
            state={state}
            ops={ops}
            fullscreen={fullscreenState}
            qualityOptions={qualityOptions}
            activeQuality={activeQuality}
            onQuality={onQuality}
          />
        </div>
      </div>
    </div>
  )
}
