/**
 * VideoSessionStage —— 视频会话的常驻宿主 + 浮层（右下小窗 / 听模式条）。
 *
 * 挂在 App 层（MiniPlayer 旁，跨路由存活）。三件事：
 * 1. 渲染隐藏的 home 容器（host 的默认归宿，保证 video 永远 isConnected）；
 * 2. 会话不在播放页时渲染浮层：画面模式 = host 容器 + 帧 chrome（播放/静音/关闭 +
 *    点击回页）；听模式 = 与播客迷你条同款视觉的简化条（host 藏 home，音频照播）；
 * 3. `createPortal` 把 `PlayableMedia` 渲染进模块级 host —— 播放页的
 *    `VideoStageSlot` 只是 host 的一个插槽，路由切走 host 换个父容器继续播。
 *
 * `SessionPlayableMedia` 的 props 全部迁自 PlayerPage 原来的 PlayableMedia
 * （resolve 闭包/onProgress/章节/听⇄看/audioStage），语义不变，只是宿主从
 * 「随路由卸载的页面」换成「常驻 Stage」。
 */

import type { MediaItem, MediaStream, PlaybackChapter } from "@amoeba/core"
import { ERROR_KIND_LABEL, errorKindOf } from "@amoeba/core/pure"
import { PlayableMedia } from "@amoeba/player"
import { MediaImage } from "@amoeba/ui"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react"
import { createPortal } from "react-dom"

import { Icon } from "../../components/Icon.tsx"
import { itemKey, mediaUrl } from "../../lib/media.ts"
import { overlayBlock } from "../../lib/uiOverlay.ts"
import { usePlayNavigate } from "../../router.tsx"
import { useDesktop } from "../../store/index.ts"
import { buildAudioStage } from "./audio-stage.tsx"
import { consumeEnded, nextInQueueOf } from "./session-queue.ts"
import {
  applyVideoPlacement,
  host,
  registerSlot,
  setHomeContainer,
  setMiniContainer,
  unregisterSlot,
  useVideoSession,
} from "./video-session.ts"

/** 没有章节时的稳定空数组（`[]` 每次渲染都是新引用 → 打穿 useMemo/useCallback）。 */
const EMPTY_CHAPTERS: PlaybackChapter[] = []

// ── 播放页插槽（PlayerPage 舞台里渲染）—————————————————————————

/**
 * 播放页的舞台占位：注册为 host 的插槽 + 打开/更新视频会话。
 * ⚠️ 注册必须 useLayoutEffect（passive cleanup 晚于 DOM 移除，会把 host 带进死树）。
 */
export function VideoStageSlot({
  item,
  from,
  listening,
}: {
  item: MediaItem
  from: string | null
  listening: boolean
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const key = itemKey(item)

  // 会话参数（条目/返回位/听⇄看）：同条目时 open 是幂等补参，绝不动 startAtSec。
  useLayoutEffect(() => {
    useVideoSession.getState().open(item, { from, mode: listening ? "listen" : "view", startAtSec: item.positionSec })
    applyVideoPlacement()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, from, listening])

  // 插槽注册：key 变化（播放页内换条目）重挂，卸载（离页）反注册 → host 转浮层/home。
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    registerSlot(el, key)
    return () => unregisterSlot()
  }, [key])

  return <div ref={ref} className="video-stage-slot" />
}

// ── 会话的 PlayableMedia（迁自 PlayerPage，语义不变）—————————————————

function SessionPlayableMedia() {
  const item = useVideoSession((s) => s.item)
  const mode = useVideoSession((s) => s.mode)
  const from = useVideoSession((s) => s.from)
  const startAtSec = useVideoSession((s) => s.startAtSec)
  const chapters = useVideoSession((s) => s.chapters)
  const settings = useDesktop((s) => s.settings)
  const danmakuVisible = useDesktop((s) => s.danmakuVisible)
  const allItems = useDesktop((s) => s.allItems)
  const previewDetail = useDesktop((s) => s.previewDetail)
  const queue = useDesktop((s) => s.queue)
  const playTo = usePlayNavigate()

  // 与 PlayerPage 同一份 known / nextInQueue 语义（预览条目也入表）。
  const known = useMemo(
    () => (previewDetail?.items.length ? [...allItems, ...previewDetail.items] : allItems),
    [allItems, previewDetail],
  )
  const nextInQueue = useMemo(() => (item ? nextInQueueOf(item, queue, known) : null), [item, queue, known])
  const inStore = useMemo(
    () => !!item && allItems.some((i) => i.subscriptionId === item.subscriptionId && i.id === item.id),
    [allItems, item],
  )
  const chapterList = useMemo(
    () => (item && chapters?.key === itemKey(item) ? chapters.list : EMPTY_CHAPTERS),
    [item, chapters],
  )
  const audioStage = useMemo(() => {
    if (!item) return undefined
    return buildAudioStage({
      item,
      listening: mode === "listen" && item.kind === "video",
      canFlipToVideo: item.kind === "video",
      chapterList,
      nextInQueue,
      from,
      playTo,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, mode, chapterList, nextInQueue, from])

  if (!item) return null
  const isLive = item.kind === "live"
  const listening = mode === "listen" && !isLive && item.kind === "video"
  const danmakuOn = danmakuVisible && (settings?.danmakuEnabled ?? true)

  return (
    <PlayableMedia
      key={itemKey(item)}
      // ⚠️ 与 PlayerPage 原实现逐条对应（含注释语义）：预览条目走 url 兜底；
      // 已带直链（播客 feed）免解析 —— 这类 item.url 是网页，resolve 必失败。
      streams={(item as { stream?: MediaStream }).stream ? [(item as { stream: MediaStream }).stream] : undefined}
      resolve={() => {
        const ref = inStore || !item.url ? item.id : item.url
        return isLive
          ? useDesktop.getState().resolveLivePlay(item.subscriptionId, ref)
          : useDesktop.getState().resolvePlay(item.subscriptionId, ref)
      }}
      // 已下播的直播不自动解析（解析必得失效流，黑屏 + 只有 console 报错）。
      autoResolve={isLive && item.liveStatus === "offline" ? false : (settings?.autoplayVideo ?? true)}
      showDanmaku={danmakuOn}
      onToggleDanmaku={(settings?.danmakuEnabled ?? true) ? useDesktop.getState().toggleDanmaku : undefined}
      // 续播：直播无位置语义；startAtSec 是 open 时的快照（重进播放页不重置）。
      startAtSec={isLive ? undefined : startAtSec}
      onProgress={(sec, dur) => {
        useDesktop.getState().savePosition(item, sec, dur)
        // 章节高亮只在跨章节时 setState（4Hz 的进度不触发订阅方重渲染）。
        const st = useVideoSession.getState()
        const list = st.chapters?.key === itemKey(item) ? st.chapters.list : EMPTY_CHAPTERS
        let idx = -1
        for (const [i, c] of list.entries()) if (sec >= c.t) idx = i
        const patch: { position: number; duration: number; chapterIdx?: number } = {
          position: sec,
          duration: dur,
        }
        if (idx !== st.chapterIdx) patch.chapterIdx = idx
        useVideoSession.setState(patch)
      }}
      onChapters={(list) => useVideoSession.setState({ chapters: { key: itemKey(item), list }, chapterIdx: -1 })}
      onMediaControl={(ctl) => useVideoSession.setState({ ctl })}
      audioOnly={listening}
      onAudioOnlyChange={(on) => useVideoSession.setState({ audioOnly: { key: itemKey(item), on } })}
      audioStage={audioStage}
      onEnded={() => consumeEnded("video", item)}
      onError={(err) => {
        const kind = errorKindOf(err)
        useDesktop.getState().toast("error", kind === "unknown" ? "播放失败" : ERROR_KIND_LABEL[kind], String(err))
      }}
    />
  )
}

// ── 浮层：画面小窗 / 听模式条 ————————————————————————————————

/** 画面模式：host 容器 + 帧chrome（播放/静音/关闭）+ 透明点击层（单击回播放页）。 */
function VideoMiniWindow() {
  const item = useVideoSession((s) => s.item)
  const from = useVideoSession((s) => s.from)
  const playing = useVideoSession((s) => s.playing)
  const muted = useVideoSession((s) => s.muted)
  const ctl = useVideoSession((s) => s.ctl)
  const close = useVideoSession((s) => s.close)
  const playTo = usePlayNavigate()
  // host 的归宿之一：小窗画面区（ref 回调注册/反注册，容器随浮层出现/消失）。
  const miniRef = useCallback((el: HTMLElement | null) => setMiniContainer(el), [])
  if (!item) return null

  return (
    <div className="vmini" {...overlayBlock("vmini", "video-mini")}>
      <div className="vmini-bar">
        <button
          type="button"
          className="vmini-btn"
          aria-label={playing ? "暂停" : "播放"}
          aria-pressed={playing}
          onClick={() => ctl?.togglePlay()}
        >
          <Icon name={playing ? "pause" : "play"} size={13} />
        </button>
        <button
          type="button"
          className="vmini-btn"
          aria-label={muted ? "取消静音" : "静音"}
          aria-pressed={muted}
          onClick={() => ctl?.toggleMute()}
        >
          <Icon name={muted ? "mute" : "volume"} size={13} />
        </button>
        <button type="button" className="vmini-btn" aria-label="关闭小窗" onClick={close}>
          <Icon name="close" size={13} />
        </button>
      </div>
      <div className="vmini-host">
        {/* host（React 树外）由 video-session.moveHost 移进这个容器。 */}
        <div ref={miniRef} className="vmini-slot" />
        {/* 透明点击层：单击回播放页；顺带挡掉 VideoShell 的 hover 控件（小窗只要帧chrome）。 */}
        <button type="button" className="vmini-tap" aria-label="回到播放页" onClick={() => playTo(item, from)} />
      </div>
    </div>
  )
}

/** 听模式：与播客迷你条同款视觉的简化条（复用 .mp-* 子类；host 藏 home 音频照播）。 */
function VideoListenBar() {
  const item = useVideoSession((s) => s.item)
  const from = useVideoSession((s) => s.from)
  const playing = useVideoSession((s) => s.playing)
  const position = useVideoSession((s) => s.position)
  const duration = useVideoSession((s) => s.duration)
  const ctl = useVideoSession((s) => s.ctl)
  const close = useVideoSession((s) => s.close)
  const playTo = usePlayNavigate()
  if (!item) return null

  const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0
  return (
    <div className="vmini-listen" {...overlayBlock("vmini-listen", "video-mini:listen")}>
      <button type="button" className="mp-cover" aria-label="回到播放页" onClick={() => playTo(item, from, "listen")}>
        <MediaImage src={mediaUrl(item)} ratio={1} fill />
      </button>
      <div className="mp-body">
        <button type="button" className="mp-title od-truncate" onClick={() => playTo(item, from, "listen")}>
          {item.title}
        </button>
        <span className="mp-sub od-truncate">正在听 · 仅音频</span>
        <span className="mp-track" aria-hidden>
          <span style={{ width: `${pct}%` }} />
        </span>
      </div>
      <button
        type="button"
        className="mp-btn"
        aria-label={playing ? "暂停" : "播放"}
        aria-pressed={playing}
        onClick={() => ctl?.togglePlay()}
      >
        <Icon name={playing ? "pause" : "play"} size={16} />
      </button>
      <button type="button" className="mp-btn" aria-label="关闭" onClick={close}>
        <Icon name="close" size={15} />
      </button>
    </div>
  )
}

// ── 常驻宿主（App 层挂载）—————————————————————————————————

export function VideoSessionStage() {
  const item = useVideoSession((s) => s.item)
  const started = useVideoSession((s) => s.started)
  const stageKey = useVideoSession((s) => s.stageKey)
  const audioOnly = useVideoSession((s) => s.audioOnly)
  const homeRef = useCallback((el: HTMLElement | null) => setHomeContainer(el), [])

  // 会话状态变化（起播/听⇄看/关会话）后收敛一次 host 归属。
  useEffect(() => {
    applyVideoPlacement()
  }, [item, started, audioOnly])

  // 浮层可见：有会话、起播过、且**本会话没有注册在播放页舞台**。
  // ⚠️ 不能用 `params.itemId !== item.id`：条目被刷新移出镜像后 PlayerPage 早退、
  // 插槽已卸载，但 URL 仍指着它 —— 那时必须显示小窗，否则 host 被留在隐藏 home，
  // 媒体继续播却没有任何暂停/关闭入口。
  const visible = !!item && started && stageKey !== itemKey(item)
  const listen = visible && !!item && audioOnly?.on === true && audioOnly.key === itemKey(item)

  return (
    <>
      {/* host 的默认归宿：永在 DOM（保 video.isConnected 的起播守卫），不可见。 */}
      <div ref={homeRef} className="video-session-home" hidden />
      {visible ? listen ? <VideoListenBar /> : <VideoMiniWindow /> : null}
      {/* 内容随会话挂/卸（close → PlayableMedia 卸载 → 引擎 destroy）。 */}
      {createPortal(item ? <SessionPlayableMedia /> : null, host)}
    </>
  )
}
