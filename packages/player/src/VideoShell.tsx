/**
 * VideoShell —— 播放器外壳:视频画面 + 控件层。
 *
 * 布局:外层 relative 容器 + `<video>` 填满;控件层 absolute 铺底。纯黑底。
 * 交互/显隐逻辑收敛到三个 hook,本组件只做组合 + JSX:
 *   - useAutoHideControls  控件自动隐藏 + 缓冲 spinner
 *   - useContainerInteractions  键盘快捷键 + 点击聚焦 + 单击播放/双击全屏
 *   - useVideoElement       媒体状态 + 操作
 */

import type { DanmakuStream } from "@amoeba/resolve"
import { useEffect, useRef, useState } from "react"

import type { DanmakuControl } from "./controls/index.ts"
import { DanmakuLayer } from "./danmaku/DanmakuLayer.tsx"
import { useMediaTime } from "./hooks/mediaClock.ts"
import { useAutoHideControls } from "./hooks/useAutoHideControls.ts"
import { useContainerInteractions } from "./hooks/useContainerInteractions.ts"
import { bindFullscreen, type FullscreenApi, useVideoElement } from "./hooks/useVideoElement.ts"
import { SpinnerIcon } from "./icons.tsx"
import { PlayerControls, type PlayerMode } from "./PlayerControls.tsx"
import { PlayerStatsOverlay } from "./PlayerStatsOverlay.tsx"
import type { EngineStats } from "./stats.ts"
import { PlayerContainerProvider, setPlayerContainer } from "./ui/PlayerContainer.tsx"
import { PlayOverlay } from "./ui/PlayOverlay.tsx"
import { VideoContextMenu } from "./ui/VideoContextMenu.tsx"

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
  sessionStartedAt,
  mode,
  theater,
  slots,
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
  /** 弹幕开关(仅当解析结果确实带弹幕时传入);弹幕行的开关。 */
  danmakuControl?: DanmakuControl
  /** 引擎/档位(统计信息面板);右键菜单里打开。 */
  stats?: EngineStats | null
  /** 播放会话起点(performance.now() 毫秒;统计面板「会话时长」)。 */
  sessionStartedAt?: number
  /** 直播/点播模式(宿主按条目 kind 显式给;不给则回退到媒体元数据判定)。 */
  mode?: PlayerMode
  /** 宽屏(剧场)开关;宿主不提供时不渲染按钮。 */
  theater?: { on: boolean; toggle: () => void }
  /**
   * 插槽(P0a-1):宿主的扩展点,默认实现保持现有视觉。
   *   - topBar:画面顶部条(标题/章节/返回),叠在画面与控件之间;
   *   - overlay:画面浮层(OSD/提示/片尾面板),不随控件显隐;
   *   - controls:替换默认控件栏(自带 `PlayerControls` 的宿主可换装)。
   */
  slots?: {
    topBar?: React.ReactNode
    overlay?: React.ReactNode
    controls?: React.ReactNode
  }
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  /** 播放器容器元素:Radix 浮层(倍速/清晰度菜单)的挂载点。全屏/小窗时必须挂在本容器内。 */
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null)
  /** 右键菜单坐标(viewport);null = 关闭。 */
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [showStats, setShowStats] = useState(false)
  // 宿主声明了模式就交给它(条目 kind 比媒体元数据可靠);未声明才回退 duration。
  const explicitLive = mode === undefined ? undefined : mode === "live"
  const { state, ops, clock } = useVideoElement(videoRef, isStreaming, onMediaError, explicitLive)
  const { showControls, showSpinner, poke, hide, hover, leave } = useAutoHideControls(state)
  const [fullscreenState, setFullscreenState] = useState<FullscreenApi>({
    isFullscreen: false,
    toggle: () => {},
  })
  const { handleClick } = useContainerInteractions(containerRef, state, ops, clock, fullscreenState.toggle)
  /** 尚未离开起点(0/1 切片 —— 不把 4Hz 时间带进本组件渲染)。 */
  const atStart = useMediaTime(clock, (s) => (s.currentTime > 0 ? 1 : 0), 0) === 0

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

  // Esc 分层:先关浮层(统计面板/右键菜单),再按第二次才退全屏(P0b-3 交互规则)。
  // ⚠️ 必须 preventDefault 第一下 —— 否则 Chromium 的默认动作会直接退全屏。
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      if (menu) {
        setMenu(null)
        e.preventDefault()
      } else if (showStats) {
        setShowStats(false)
        e.preventDefault()
      }
    }
    el.addEventListener("keydown", onKey)
    return () => el.removeEventListener("keydown", onKey)
  }, [menu, showStats])

  // 未起播 → 大播放键(autoPlay 起播瞬间不闪);播放中暂停 → 悬停播放键。
  // started(video 已起播过):autoPlay 起播等待期(paused 但从未 playing)不显示任何
  // 播放键——否则大屏打开时 resolve 结束的 spin 会闪现播放按钮再缓冲 spin。
  const showBigPlay = !autoPlay && !state.started && state.paused && !state.ended && !state.waiting && atStart
  const showPausedOverlay = state.paused && !showBigPlay && !state.ended && state.started

  // ⚠️ video 只填容器(比例由容器管):给 video 加 aspect-ratio 会与 h-full/w-full
  // 冲突,加载中塌成窄黑条。故比例全靠容器撑。
  const mediaClass = ["h-full", "w-full", "object-contain"].filter(Boolean).join(" ")
  const isFullscreen = fullscreenState.isFullscreen

  return (
    <PlayerContainerProvider value={portalContainer}>
      <div
        ref={(el) => {
          containerRef.current = el
          setPlayerContainer(el)
          setPortalContainer(el)
        }}
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
        {danmaku && <DanmakuLayer danmaku={danmaku} clock={clock} live={state.live} paused={state.paused} />}

        {showSpinner && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
            <SpinnerIcon className="h-12 w-12 animate-spin text-white/80" />
          </div>
        )}

        {showBigPlay && <PlayOverlay variant="big" onPlay={ops.togglePlay} />}
        {showPausedOverlay && <PlayOverlay variant="paused" onPlay={ops.togglePlay} />}

        {/* 宿主插槽:画面浮层(OSD/提示),不随控件显隐 */}
        {slots?.overlay ? <div className="pointer-events-none absolute inset-0 z-10">{slots.overlay}</div> : null}

        {/* 统计信息(右键菜单打开) */}
        {showStats ? (
          <PlayerStatsOverlay
            videoRef={videoRef}
            stats={stats}
            sessionStartedAt={sessionStartedAt}
            live={explicitLive}
            quality={qualityOptions.find((q) => q.rate === activeQuality)?.quality}
          />
        ) : null}

        {/* 右键菜单:只有「统计信息」一项(不自造完整菜单体系)。 */}
        {menu ? (
          <VideoContextMenu
            x={menu.x}
            y={menu.y}
            statsShown={showStats}
            onToggleStats={() => setShowStats((v) => !v)}
            onClose={() => setMenu(null)}
          />
        ) : null}

        {/* 宿主插槽:顶部条(标题/章节/返回),叠在画面之上 */}
        {slots?.topBar ? <div className="absolute inset-x-0 top-0 z-20">{slots.topBar}</div> : null}

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
            {slots?.controls ?? (
              <PlayerControls
                state={state}
                ops={ops}
                clock={clock}
                fullscreen={fullscreenState}
                qualityOptions={qualityOptions}
                activeQuality={activeQuality}
                onQuality={onQuality}
                danmakuControl={danmakuControl}
                mode={mode}
                theater={theater}
                container={portalContainer}
              />
            )}
          </div>
        </div>
      </div>
    </PlayerContainerProvider>
  )
}
