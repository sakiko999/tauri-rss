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
import type { DanmakuStream } from "@amoeba/resolve"
import { bindFullscreen, type FullscreenApi, useVideoElement } from "./hooks/useVideoElement.ts"
import { useAutoHideControls } from "./hooks/useAutoHideControls.ts"
import { useContainerInteractions } from "./hooks/useContainerInteractions.ts"
import { PlayerControls } from "./PlayerControls.tsx"
import { PlayerStatsOverlay } from "./PlayerStatsOverlay.tsx"
import type { EngineStats } from "./stats.ts"
import type { DanmakuControl } from "./controls/index.ts"
import { PlayIcon, SpinnerIcon } from "./icons.tsx"
import { DanmakuLayer } from "./danmaku/DanmakuLayer.tsx"

export function VideoShell({
  videoRef,
  isStreaming,
  className,
  src,
  autoPlay = false,
  qualityOptions,
  activeQuality,
  onQuality,
  onMediaError,
  danmaku,
  danmakuControl,
  stats,
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
  /** 原生 video 加载失败(403/断流/格式不支持)上报——让 PlayableMedia 弹 playError UI。 */
  onMediaError?: (code: number | undefined, msg: string) => void
  /** 弹幕流(随 resolve 结果附带;无弹幕平台 undefined 不渲染层)。 */
  danmaku?: DanmakuStream
  /** 弹幕开关(仅当解析结果确实带弹幕时传入);按钮渲染在控件栏内。 */
  danmakuControl?: DanmakuControl
  /** 引擎/档位(统计信息面板);右键菜单里打开。 */
  stats?: EngineStats | null
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  /** 右键菜单坐标(viewport);null = 关闭。 */
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [showStats, setShowStats] = useState(false)
  const { state, ops } = useVideoElement(videoRef, isStreaming, onMediaError)
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
  // started(video 已起播过):autoPlay 起播等待期(paused 但从未 playing)不显示任何
  // 播放键——否则大屏打开时 resolve 结束的 spin 会闪现播放按钮再缓冲 spin。
  const showBigPlay = !autoPlay && !state.started && state.paused && !state.ended && !state.waiting && state.currentTime === 0
  const showPausedOverlay = state.paused && !showBigPlay && !state.ended && state.started

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
      onContextMenu={(e) => {
        // 仿 YouTube:右键出菜单(统计信息),屏蔽浏览器默认菜单。
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
      onDoubleClick={(e) => {
        e.preventDefault()
        fullscreenState.toggle()
      }}
      className={[
        "group flex items-center justify-center overflow-hidden bg-black outline-none",
        // 统一自撑 16:9:relative w-full + padding-top 撑开(video 未初始化也必然有
        // 高度),父容器无需定比例。全屏时 h-full w-full 撑满。
        // ⚠️ **无圆角**:常见播放器都是满幅方角设计,播放器不该自带圆角(曾在
        // VideoShell / PlayerControls / MediaState 各写死一档、互相错位)。方角是
        // 产品决定,不是待补的样式。
        isFullscreen ? "h-full w-full relative" : "relative w-full",
        className,
      ].join(" ")}
      style={isFullscreen ? undefined : { paddingTop: "56.25%" }}
    >
      {/* video absolute 填满容器:自撑时 padding-top 后内容区高为 0,必须 absolute。 */}
      <video
        ref={videoRef}
        className={["absolute inset-0", mediaClass].filter(Boolean).join(" ")}
        playsInline
        preload="auto"
      />

      {/* 弹幕层:video 之上、控件之下。有 timeMs 的按 currentTime 窗口发射(点播),
          无 timeMs 的实时追加(live);点播暂停冻结,live 暂停照收。 */}
      {danmaku && <DanmakuLayer danmaku={danmaku} currentTime={state.currentTime} live={state.live} paused={state.paused} />}

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

      {/* 统计信息(右键菜单打开) */}
      {showStats ? (
        <PlayerStatsOverlay
          videoRef={videoRef}
          stats={stats}
          quality={qualityOptions.find((q) => q.rate === activeQuality)?.quality}
        />
      ) : null}

      {/* 右键菜单:只有「统计信息」一项(不自造完整菜单体系)。 */}
      {menu ? (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={(e) => {
              // 菜单在播放容器内:不拦冒泡会触发容器的单击播放/暂停。
              e.stopPropagation()
              setMenu(null)
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setMenu(null)
            }}
          />
          <div
            className="fixed z-50 min-w-36 rounded-md border border-white/15 bg-black/95 py-1 text-xs text-white shadow-xl"
            style={{
              // 贴边时向内收,避免菜单出视口(YouTube 同款行为)。
              left: Math.min(menu.x, window.innerWidth - 152),
              top: Math.min(menu.y, window.innerHeight - 44),
            }}
          >
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left hover:bg-white/15"
              onClick={(e) => {
                e.stopPropagation()
                setShowStats((v) => !v)
                setMenu(null)
              }}
            >
              {showStats ? "隐藏统计信息" : "统计信息"}
            </button>
          </div>
        </>
      ) : null}

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
            danmakuControl={danmakuControl}
          />
        </div>
      </div>
    </div>
  )
}
