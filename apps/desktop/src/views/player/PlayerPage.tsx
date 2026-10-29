/**
 * PlayerPage —— 播放页。
 *
 * ⚠️ new_desktop 的播放页是**演示**:封面当画面 + 自造弹幕时钟,没有 <video>。
 * 这里用真实现成:舞台内是 `PlayableMedia`(player 包,自带 hls/flv/dash 分发 +
 * 弹幕层 + 控件),外围(队列 / 相关 / 元信息 / 快捷键)照 new_desktop 移植。
 *
 * 解析走 core:video → resolvePlay, live → resolveLivePlay;两者都返回
 * `{ streams, danmaku }`,danmaku 由 PlayableMedia 内部接给 DanmakuLayer。
 */

import {
  ERROR_KIND_LABEL,
  errorKindOf,
  type MediaItem,
  type MediaKind,
  type MediaStream,
  type PlaybackChapter,
} from "@amoeba/core"
import { AudioShell, PlayableMedia } from "@amoeba/player"
import { MediaImage } from "@amoeba/ui"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router"

import { Button, IconButton } from "../../components/Button.tsx"
import { Icon } from "../../components/Icon.tsx"
import { SideCard, StateBlock } from "../../components/StateBlock.tsx"
import { openExternalSafely } from "../../lib/host.ts"
import { fmtAgo, fmtTime, itemKey, mediaUrl, onlineOf, PLATFORM_LABEL, platformOf } from "../../lib/media.ts"
import { overlayBlock } from "../../lib/uiOverlay.ts"
import { previewPath, usePlayNavigate, usePlayParams, viewPath } from "../../router.tsx"
import { useDesktop } from "../../store/index.ts"
import { KIND_META } from "../../store/nodes.ts"
import { audioSessionEl, audioSessionRef, useAudioSession } from "./audio-session.ts"

/** 没有章节时的稳定空数组（`[]` 每次渲染都是新引用 → 会打穿 useMemo/useCallback）。 */
const EMPTY_CHAPTERS: PlaybackChapter[] = []

export function PlayerPage() {
  const { itemId, from, sub, mode } = usePlayParams()
  const allItems = useDesktop((s) => s.allItems)
  const previewDetail = useDesktop((s) => s.previewDetail)
  const queue = useDesktop((s) => s.queue)
  const resolvePlay = useDesktop((s) => s.resolvePlay)
  const resolveLivePlay = useDesktop((s) => s.resolveLivePlay)
  const addToQueue = useDesktop((s) => s.addToQueue)
  const removeFromQueue = useDesktop((s) => s.removeFromQueue)
  const clearQueue = useDesktop((s) => s.clearQueue)
  const toggleStar = useDesktop((s) => s.toggleStar)
  const savePosition = useDesktop((s) => s.savePosition)
  const danmakuVisible = useDesktop((s) => s.danmakuVisible)
  const toggleDanmaku = useDesktop((s) => s.toggleDanmaku)
  const settings = useDesktop((s) => s.settings)
  const navigate = useNavigate()
  // ⚠️ 播放页内跳向另一条内容必须走 /play/:itemId。用 go("play:"+id) 会生成
  // `/v/play%3Aid`,App 的 isPlay 判的是 params.itemId → 落到 MediaMain 网格。
  const playTo = usePlayNavigate()
  /** 剧场模式:单列 + 收起右栏(队列/同订阅),把宽度全给画面。只存本页状态,不改设置。 */
  const [theater, setTheater] = useState(false)
  /**
   * 播放器回报的「实际是否纯音频」。带条目键:切条目时旧值自动失效(不会把上一条的
   * 音频版式套到新条目上,等播放器重新回报)。
   */
  const [appliedAudioOnly, setAppliedAudioOnly] = useState<{ key: string; on: boolean } | null>(null)
  /** 播放器回报的章节（目前只有 bili 有）。同样带条目键：切条目时旧值自动失效。 */
  const [chapters, setChapters] = useState<{ key: string; list: PlaybackChapter[] } | null>(null)
  /** 播放器给的跳转句柄（章节栏点击定位；元素换了会重新给）。 */
  const [mediaCtl, setMediaCtl] = useState<{ seek: (sec: number) => void } | null>(null)
  /**
   * 当前章节下标：由 onProgress 顺带算，**只在跨章节时** setState（4Hz 的高频进度
   * 不触发页面重渲染）。
   */
  const [chapterIdx, setChapterIdx] = useState(-1)
  const chapterIdxRef = useRef(-1)

  // ⚠️ 合并 `previewDetail`:二级订阅的单集/房间是**临时预览**出来的(未落库、未建订阅),
  // 只查 allItems 会「找不到这条内容」。队列/下一条也走这份合并表。
  const known = useMemo(
    () => (previewDetail?.items.length ? [...allItems, ...previewDetail.items] : allItems),
    [allItems, previewDetail],
  )
  // ⚠️ `id` 只在订阅内唯一,必须带订阅定位:
  //   ① `?sub=` 是导航时写入的**条目真实 subscriptionId**（聚合节点下 `from` 只是节点 id）;
  //   ② 预览条目(`preview:*`)是刚抓的快照,比库里同一房间的旧快照新 —— 从该节点进来时优先;
  //   ③ 兼容旧链接：`from` 若恰好是真实订阅 id，也按它精确匹配;
  //   ④ 最后才退回裸 id(理论上只剩「订阅已被删」的兜底)。
  const item = useMemo(() => {
    if (!itemId) return null
    const inPreview = previewDetail?.nodeId === from ? previewDetail.items.find((i) => i.id === itemId) : undefined
    const bySub = sub ? known.find((i) => i.id === itemId && i.subscriptionId === sub) : undefined
    const byFrom = from ? known.find((i) => i.id === itemId && i.subscriptionId === from) : undefined
    // 有 sub 时**不再**退回裸 id：那会命中另一订阅的同 id 条目，正是本次要消除的行为。
    // 只有旧链接（无 sub）才保留裸 id 兜底。
    const bare = sub ? undefined : known.find((i) => i.id === itemId)
    return inPreview ?? bySub ?? byFrom ?? bare ?? null
  }, [known, itemId, from, sub, previewDetail])
  // 预览条目不在库里(订阅 id 是 `preview:*`),播放解析要改走 url 兜底(见下方 resolve)。
  const inStore = useMemo(
    () => !!item && allItems.some((i) => i.subscriptionId === item.subscriptionId && i.id === item.id),
    [allItems, item],
  )
  // ⚠️ 队列存的是 `subId:itemId` 复合键(见 store 的 queue 注释),用 itemKey 反查 ——
  // 只比 id 会命中**别的订阅**的同 id 条目。已不在库里的(退订/被刷新换掉)直接跳过。
  const queueItems = useMemo(() => {
    const byKey = new Map(known.map((i) => [itemKey(i), i]))
    return queue.map((k) => byKey.get(k)).filter((x): x is MediaItem => !!x)
  }, [queue, known])
  /**
   * 同订阅的「接下来几条」：从当前条目往后数（原型的「接下来播放」语义），到尾部
   * 再回卷到最新几条。
   * ⚠️ 必须查 `known` 而不是 `allItems`：播客单集是**预览条目**（不在库里），只查
   * allItems 时这一栏永远是空的（而单集恰恰最需要「接着听下一集」）。
   */
  const related = useMemo(() => {
    if (!item) return []
    const same = known.filter((i) => i.subscriptionId === item.subscriptionId)
    const idx = same.findIndex((i) => i.id === item.id)
    const after = idx >= 0 ? same.slice(idx + 1, idx + 7) : []
    const pool = after.length ? after : same.filter((i) => i.id !== item.id).slice(0, 6)
    return pool.slice(0, 6)
  }, [known, item])

  // 返回位置：从二级预览里播的，回预览（`?open=`）；否则回来源节点。
  // 预览内容不在库里，回来源节点会丢掉"单集列表"这一层，用户得再点一次节目。
  // ⚠️ 只有**当前这条确实来自预览**才回 `?open=`;previewDetail 不会被清空,
  // 只比 nodeId 的话,同一订阅下播普通条目按返回会被送回上次的预览页。
  const fromPreview = useMemo(
    () =>
      !!item &&
      !!previewDetail &&
      previewDetail.items.some((i) => i.id === item.id && i.subscriptionId === item.subscriptionId),
    [item, previewDetail],
  )
  const backTo = useCallback(() => {
    if (from && fromPreview && previewDetail?.nodeId === from) return previewPath(from, previewDetail.itemId)
    return viewPath(from ?? "tab:all")
  }, [previewDetail, from, fromPreview])

  // 播放页按键:Esc 返回;←/→ 交给播放器控件;空格由播放器处理。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      // ⚠️ 浮层守卫:命令面板(⌘K 全局可开)等也监听 Esc。不守卫的话一次 Esc 会**同时**
      // 关面板 + 退出播放页(两个导航副作用)。面板/已 preventDefault 的浮层先吃掉。
      if (e.defaultPrevented || useDesktop.getState().paletteOpen) return
      navigate(backTo())
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [backTo, navigate])

  // 播放队列里的下一条。按复合键定位(见上)。
  const nextInQueue = useMemo(() => {
    if (!item) return null
    const idx = queue.indexOf(itemKey(item))
    if (idx < 0) return null
    const nextKey = queue[idx + 1]
    if (!nextKey) return null
    return known.find((i) => itemKey(i) === nextKey) ?? null
  }, [queue, item, known])

  // ── 播客单集：会话级播放器（离开播放页继续听，迷你条共用同一个元素）──────────
  // ⚠️ 这些 effect 必须在 `!item` 早退**之前**：React 的 hook 数量不能随渲染分支变化。
  // ⚠️ 依赖表只能放**值**：回调（playTo/removeFromQueue）每次渲染都是新函数，
  //    放进 deps 会让「effect → setState → 重渲染 → effect」无限循环（实测
  //    Maximum update depth exceeded）。回调走 ref 读最新。
  const chapterList = useMemo(
    () => (item && chapters?.key === itemKey(item) ? chapters.list : EMPTY_CHAPTERS),
    [item, chapters],
  )
  const chapterAt = useCallback(
    (sec: number) => {
      let idx = -1
      for (const [i, c] of chapterList.entries()) if (sec >= c.t) idx = i
      return idx
    },
    [chapterList],
  )
  const podcastSource = item && item.kind === "audio" ? (item as { stream?: MediaStream }).stream?.url : undefined

  const chapterAtRef = useRef(chapterAt)
  chapterAtRef.current = chapterAt
  /** 播完下一条：读渲染期的最新值（不放进 effect 依赖）。 */
  const endedRef = useRef<() => void>(() => {})
  endedRef.current = () => {
    if (!item || !(settings?.autoPlayNext ?? true)) return
    removeFromQueue(item)
    if (nextInQueue) playTo(nextInQueue, from)
  }

  useEffect(() => {
    if (!item || !podcastSource) return
    useAudioSession.getState().open(item, podcastSource, item.positionSec)
  }, [item, podcastSource])

  // 打开的是视频/直播页：先停掉会话里的播客，避免两路声音叠在一起（迷你条里可随时续上）。
  useEffect(() => {
    if (!item || podcastSource) return
    audioSessionEl.pause()
  }, [item, podcastSource])

  // 会话元素的进度/播完/定位：元素在模块里，页面只挂监听（切条目时重挂）。
  useEffect(() => {
    if (!podcastSource) return
    const el = audioSessionEl
    setMediaCtl({
      seek: (t: number) => {
        try {
          el.currentTime = Math.max(0, t)
        } catch {
          /* 未就绪时忽略 */
        }
      },
    })
    const onTime = () => {
      const i = chapterAtRef.current(el.currentTime)
      if (i !== chapterIdxRef.current) {
        chapterIdxRef.current = i
        setChapterIdx(i)
      }
    }
    const onEnded = () => endedRef.current()
    el.addEventListener("timeupdate", onTime)
    el.addEventListener("ended", onEnded)
    return () => {
      el.removeEventListener("timeupdate", onTime)
      el.removeEventListener("ended", onEnded)
      setMediaCtl(null)
    }
  }, [podcastSource])

  if (!item) {
    return (
      <div className="page" {...overlayBlock("player-missing", "player:missing")}>
        <div className="page-scroll scroll-area" {...overlayBlock("player-missing-scroll", "player:missing:scroll")}>
          <StateBlock
            icon="play"
            title="找不到这条内容"
            text="它可能已被刷新替换。回到列表重新选择。"
            actions={
              <Button variant="secondary" onClick={() => navigate(backTo())}>
                <Icon name="back" size={14} /> 返回列表
              </Button>
            }
          />
        </div>
      </div>
    )
  }

  const isLive = item.kind === "live"
  const online = onlineOf(item)
  const platform = platformOf(item)
  // 听视频(?mode=listen):只对点播视频有意义 —— live 无独立音轨、audio 本来就是听的。
  // 流是 DASH 才真能听(bili/youtube);durl 回退流剥不出音轨时播放器自动照常播视频。
  const listening = mode === "listen" && !isLive && item.kind === "video"
  // 音频版式:播客单集(kind=audio 且有直链)与视频的「听」模式共用一套
  // 封面 + 音频控件页(原型的 pod 播放页子集:进度/±15-30/倍速/睡眠定时)。
  // ⚠️ 播客单集**天然**是纯音频(直链在 refresh 里就带着),立刻摆封面;「听视频」要等
  // 播放器真剥出音轨才成立 —— 剥不动(durl 回退的混合轨)时它是视频,摆封面就会和画面
  // 挤在同一套音频版式里,所以听模式一律听播放器回报(`onAudioOnlyChange`)。
  const podcastAudio = item.kind === "audio" && !!(item as { stream?: MediaStream }).stream
  const audioMode = podcastAudio || (listening && appliedAudioOnly?.key === itemKey(item) && appliedAudioOnly.on)
  const durationSec =
    (item as { durationSec?: number; duration?: number }).durationSec ?? (item as { duration?: number }).duration
  /** 简介：两种版式都放在播放器**下方**（右栏留给章节/队列/同订阅）。 */
  const summaryCard = item.summary ? (
    <SideCard title={audioMode ? "本集简介" : "简介"} icon="info" pad blockKey="player:summary">
      <p className="t-small t-muted" style={{ lineHeight: 1.7 }}>
        {item.summary}
      </p>
    </SideCard>
  ) : null
  // 弹幕:设置总开关 × 播放页临时覆盖。关掉时 resolve 结果里的 danmaku 不交给播放器。
  const danmakuOn = danmakuVisible && (settings?.danmakuEnabled ?? true)

  /**
   * 音频版式的播放面（原型 podplay）：封面 / 「正在播放」/ 标题 / 节目名 / 元信息 +
   * 次要动作。原来那排按钮在 .player-meta 里，音频模式下整块不渲染 —— 动作挪到这里，
   * 避免同一件事两处出现。两种音频来源（会话 / PlayableMedia）共用这一份。
   */
  const audioStage = {
    seed: itemKey(item),
    artwork: mediaUrl(item) || undefined,
    kicker: listening ? "正在播放 · 仅音频" : "正在播放 · 播客单集",
    title: item.title,
    subtitle: item.author?.name,
    chapters: chapterList,
    meta: (
      <>
        <span>{fmtAgo(item.publishedAt)}</span>
        {durationSec ? (
          <>
            <span className="opacity-60">·</span>
            <span>{fmtTime(durationSec)}</span>
          </>
        ) : null}
        {platform ? (
          <>
            <span className="opacity-60">·</span>
            <span>{PLATFORM_LABEL[platform] ?? platform}</span>
          </>
        ) : null}
      </>
    ),
    actions: (
      <>
        {item.kind === "video" && !isLive ? (
          listening ? (
            <Button variant="quiet" size="sm" onClick={() => playTo(item, from)}>
              <Icon name="monitor" size={14} /> 看视频
            </Button>
          ) : (
            <Button variant="quiet" size="sm" onClick={() => playTo(item, from, "listen")}>
              <Icon name="music" size={14} /> 只听声音
            </Button>
          )
        ) : null}
        {nextInQueue ? (
          <Button variant="quiet" size="sm" onClick={() => playTo(nextInQueue, from, listening ? "listen" : undefined)}>
            <Icon name="skipForward" size={14} /> 下一条
          </Button>
        ) : null}
        {item.url ? (
          <Button variant="quiet" size="sm" onClick={() => openExternalSafely(item.url)}>
            <Icon name="external" size={14} /> 打开原文
          </Button>
        ) : null}
      </>
    ),
  }

  return (
    <div
      className="player-view"
      // data 属性(不是新类名)驱动剧场模式:与 1280 断点收单列的 @media 规则互不覆盖,
      // 两边同时命中也是同一结果(单列),不会出现「窄窗 + 剧场」两套规则打架。
      data-theater={theater ? "on" : undefined}
      {...overlayBlock("player-view", "player:view")}
    >
      <header className="detail-head" {...overlayBlock("player-head", "player:head")}>
        <IconButton size="sm" aria-label="返回" onClick={() => navigate(backTo())}>
          <Icon name="back" size={15} />
        </IconButton>
        <span className="titlebar-path od-truncate min-w-0 flex-1">{item.title}</span>
        <IconButton size="sm" aria-label="加入队列" onClick={() => addToQueue(item)} title="加入队列">
          <Icon name="queue" size={15} />
        </IconButton>
        <IconButton
          size="sm"
          aria-label={item.isStarred ? "取消星标" : "星标"}
          aria-pressed={!!item.isStarred}
          onClick={() => toggleStar(item)}
        >
          <Icon name="star" size={15} />
        </IconButton>
      </header>

      <div className="scroll-area player-scroll" {...overlayBlock("player-scroll", "player:scroll")}>
        <div className="player-layout" {...overlayBlock("player-layout", "player:layout")}>
          <div {...overlayBlock("player-main-col", "player:main-col")}>
            <div
              className="stage"
              data-audio={audioMode ? "on" : undefined}
              {...overlayBlock("player-stage", "player:stage")}
            >
              {/* PlayableMedia/VideoShell 自带 relative + aspect-ratio 容器与控件层。
                  ⚠️ **播放器无圆角**(常见播放器都是满幅方角设计)——player 包方角,
                  这里也不再包圆角。stage 只负责宽度上限与居中(见 styles.css .stage)。
                  音频版式下 stage 不摆封面：整张「播放面」(封面/标题/声纹波形/控件)
                  由 AudioShell 自己渲染（原型 pod-stage 是一张卡片，不是黑舞台）。 */}
              {podcastAudio && podcastSource ? (
                /* 播客单集：媒体元素在会话模块里（跨路由存活），这里只是控制面。 */
                <AudioShell
                  mediaRef={audioSessionRef}
                  ownElement={false}
                  {...audioStage}
                  onError={(e) => useDesktop.getState().toast("error", "播放失败", String(e))}
                />
              ) : (
                <PlayableMedia
                  key={itemKey(item)}
                  // 统一传 item.id：core 的 findItemUrl 按 (subscriptionId, id) 命中并取
                  // item.url（预览条目不在库内时传 url 走兜底）。
                  // ⚠️ refresh 已带直链时(feed enclosure,如播客)直接给 streams —— 这类
                  // item.url 是**网页**(不可 by-url 路由),靠 resolve 必失败。
                  streams={
                    (item as { stream?: MediaStream }).stream ? [(item as { stream: MediaStream }).stream] : undefined
                  }
                  resolve={() => {
                    // ⚠️ 预览条目(二级订阅)不在库里,core 的 findItemUrl 按 subscriptionId 查不到 →
                    // 传 url 走它「入参本身是 URL」的兜底;否则会误报「不指向可解析的视频链接」。
                    const ref = inStore || !item.url ? item.id : item.url
                    return isLive ? resolveLivePlay(item.subscriptionId, ref) : resolvePlay(item.subscriptionId, ref)
                  }}
                  // ⚠️ 已下播的直播不自动解析:解析必得已验证失效的流(douyin flv 404 /
                  // huya 空),表现为黑屏 + 只有 console 报错。交给用户点「播放」手动重试。
                  autoResolve={isLive && item.liveStatus === "offline" ? false : (settings?.autoplayVideo ?? true)}
                  // 弹幕总开关关闭时不建弹幕连接(而非建了再藏)。
                  showDanmaku={danmakuOn}
                  // 开关渲染在播放器控件栏里;全局设置关闭时不给按钮(按了也不会生效)。
                  onToggleDanmaku={(settings?.danmakuEnabled ?? true) ? toggleDanmaku : undefined}
                  // 续播:非直播才有位置语义(item.positionSec 由 core 从 reading 回填)。
                  startAtSec={isLive ? undefined : item.positionSec}
                  onProgress={(sec, dur) => {
                    savePosition(item, sec, dur)
                    // 章节高亮只在**跨章节**时 setState：4Hz 的进度不触发页面重渲染。
                    const i = chapterAt(sec)
                    if (i !== chapterIdxRef.current) {
                      chapterIdxRef.current = i
                      setChapterIdx(i)
                    }
                  }}
                  // 章节（目前只有 bili 给）：没有就是空数组，右栏那一栏不渲染。
                  onChapters={(list) => setChapters({ key: itemKey(item), list })}
                  // 章节栏点击定位用的跳转句柄（元素换了会重新给，卸载给 null）。
                  onMediaControl={setMediaCtl}
                  audioOnly={listening}
                  // 听模式剥没剥出音轨只有播放器知道 → 页面据此决定摆音频版式还是 16:9 舞台。
                  onAudioOnlyChange={(on) => setAppliedAudioOnly({ key: itemKey(item), on })}
                  // 音频版式的播放面（原型 podplay）：见下方 audioStage。
                  audioStage={audioStage}
                  // 播完自动下一条:仅当设置开着**且**队列里确实有下一条时。播过的当前条
                  // 同时出队(与「播放队列」的语义一致 —— 它是待播列表,不是播放历史)。
                  onEnded={() => {
                    if (!(settings?.autoPlayNext ?? true)) return
                    removeFromQueue(item)
                    if (nextInQueue) playTo(nextInQueue, from, listening ? "listen" : undefined)
                  }}
                  onError={(err) => {
                    const kind = errorKindOf(err)
                    useDesktop
                      .getState()
                      .toast("error", kind === "unknown" ? "播放失败" : ERROR_KIND_LABEL[kind], String(err))
                  }}
                />
              )}
            </div>

            {/* 音频版式不要这块:标题/元信息/次要动作都在 AudioShell 的播放面里,
                再在下面写一遍就是「同一件事两处」。 */}
            {audioMode ? null : (
              <div className="player-meta" {...overlayBlock("player-meta", "player:meta")}>
                <h1 className="player-title">{item.title}</h1>
                <div className="player-sub">
                  {isLive ? (
                    // ⚠️ 按 liveStatus 标注:曾对所有 live 无脑写「● 直播中」——已下播的
                    // 房间也显示直播中(说谎)。offline/unknown 如实标。
                    item.liveStatus === "live" ? (
                      <span className="tag tag-live">● 直播中</span>
                    ) : (
                      <span className="tag">○ 已下播</span>
                    )
                  ) : (
                    <span className="tag">
                      {/* 无时长就显示「视频」/「音频」,不写语义含糊的「点播」。 */}
                      {(item as { durationSec?: number }).durationSec
                        ? fmtTime((item as { durationSec?: number }).durationSec)
                        : item.kind === "audio"
                          ? "音频"
                          : "视频"}
                    </span>
                  )}
                  {platform ? <span>{PLATFORM_LABEL[platform] ?? platform}</span> : null}
                  {item.author?.name ? <span>{item.author.name}</span> : null}
                  {/* 0 也要显示:直播「无人观看」是有用的状态,不该被 truthy 判断吞掉。 */}
                  {online !== undefined ? <span className="num">{online} 人在看</span> : null}
                  {/* 时间靠右 —— 与列表/卡片同一套编排(元信息不再用 `·` 串成一句)。 */}
                  <span className="player-time">{fmtAgo(item.publishedAt)}</span>
                </div>
                <div className="player-actions">
                  {/* 听/看切换(点播视频):同一份解析结果换元素播,不重解析;进度由播放器带过去。 */}
                  {item.kind === "video" && !isLive ? (
                    listening ? (
                      <Button variant="quiet" onClick={() => playTo(item, from)}>
                        <Icon name="monitor" size={14} /> 看视频
                      </Button>
                    ) : (
                      <Button variant="quiet" onClick={() => playTo(item, from, "listen")}>
                        <Icon name="music" size={14} /> 只听声音
                      </Button>
                    )
                  ) : null}
                  {/* 剧场模式放控制区(与队列/下一条同一行):它是「怎么放」而不是「放什么」。
                    音频页没有画面,剧场模式无意义。 */}
                  {audioMode ? null : (
                    <Button variant="quiet" aria-pressed={theater} onClick={() => setTheater((v) => !v)}>
                      <Icon name="monitor" size={14} /> 剧场模式
                    </Button>
                  )}
                  <Button variant="quiet" onClick={() => addToQueue(item)}>
                    <Icon name="queue" size={14} /> 加入队列
                  </Button>
                  {nextInQueue ? (
                    <Button variant="quiet" onClick={() => playTo(nextInQueue, from, listening ? "listen" : undefined)}>
                      <Icon name="skipForward" size={14} /> 下一条：{nextInQueue.title.slice(0, 16)}
                    </Button>
                  ) : null}
                  {item.url ? (
                    <Button variant="quiet" onClick={() => openExternalSafely(item.url)}>
                      <Icon name="external" size={14} /> 打开原文
                    </Button>
                  ) : null}
                </div>
              </div>
            )}

            {summaryCard ? <div className="section-first">{summaryCard}</div> : null}
          </div>

          {/* ⚠️ `player-side` 类给剧场模式用(data-theater=on 时 display:none)——
              只靠 overlayBlock 的属性没法在 CSS 里稳定选中(DEV 之外它根本不渲染)。 */}
          <aside
            className="stack player-side"
            data-audio={audioMode ? "on" : undefined}
            {...overlayBlock("player-side", "player:side")}
          >
            {chapterList.length ? (
              <SideCard title="章节" icon="list" blockKey="player:chapters">
                <div className="pod-chapters">
                  {chapterList.map((c, i) => (
                    <button
                      key={`${c.t}-${i}`}
                      type="button"
                      className="pod-chapter"
                      aria-current={i === chapterIdx ? "true" : undefined}
                      onClick={() => mediaCtl?.seek(c.t)}
                    >
                      <span className="ch-t">{fmtTime(c.t)}</span>
                      <span className="ch-label">{c.label}</span>
                    </button>
                  ))}
                </div>
              </SideCard>
            ) : null}
            <SideCard title={`播放队列 ${queueItems.length}`} icon="queue" blockKey="player:queue">
              {queueItems.length === 0 ? (
                <p className="rail-empty">队列为空。在卡片上点 + 加入,或从列表播放。</p>
              ) : (
                <>
                  {queueItems.map((it, i) => (
                    <button
                      key={itemKey(it)}
                      className="queue-row"
                      aria-current={itemKey(it) === itemKey(item) ? "true" : undefined}
                      /* 在听模式里点队列/相关条目,沿用听模式 —— 否则每换一集都被踹回画面。 */
                      onClick={() => playTo(it, from, listening ? "listen" : undefined)}
                    >
                      <span className="queue-rank num">{i + 1}</span>
                      <span className="queue-thumb">
                        <MediaImage src={mediaUrl(it)} ratio={16 / 9} fill />
                      </span>
                      <span className="queue-body">
                        <span className="queue-title od-truncate">{it.title}</span>
                        <span className="queue-sub">{it.author?.name ?? kindName(it.kind)}</span>
                      </span>
                      {itemKey(it) === itemKey(item) ? (
                        <span className="queue-flag">
                          <Icon name="play" size={12} />
                        </span>
                      ) : null}
                    </button>
                  ))}
                  <div style={{ padding: "var(--sp-2)" }}>
                    <Button variant="quiet" block size="sm" onClick={clearQueue}>
                      <Icon name="trash" size={13} /> 清空队列
                    </Button>
                  </div>
                </>
              )}
            </SideCard>

            <SideCard title="来自同一订阅" icon="rss" blockKey="player:related">
              {related.length === 0 ? (
                <p className="rail-empty">该订阅下暂无其它条目。</p>
              ) : (
                related.map((it) => (
                  <button
                    key={itemKey(it)}
                    className="queue-row"
                    onClick={() => playTo(it, from, listening ? "listen" : undefined)}
                  >
                    <span className="queue-thumb">
                      <MediaImage src={mediaUrl(it)} ratio={16 / 9} fill />
                    </span>
                    <span className="queue-body">
                      <span className="queue-title clamp-2">{it.title}</span>
                      <span className="queue-sub">{fmtAgo(it.publishedAt)}</span>
                    </span>
                  </button>
                ))
              )}
            </SideCard>
          </aside>
        </div>
      </div>
    </div>
  )
}

/** kind 的展示名统一走 KIND_META（本地副本曾缺 category，与侧栏漂移）。 */
function kindName(kind: string): string {
  return KIND_META[kind as MediaKind]?.label ?? kind
}
