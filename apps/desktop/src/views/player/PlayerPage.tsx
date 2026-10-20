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
import { useCallback, useEffect, useMemo } from "react"
import { useNavigate } from "react-router"
import { PlayableMedia } from "@amoeba/player"
import type { MediaItem, MediaStream } from "@amoeba/core"
import { useDesktop } from "../../store/index.ts"
import { previewPath, usePlayNavigate, usePlayParams, viewPath } from "../../router.tsx"
import { Icon } from "../../components/Icon.tsx"
import { StateBlock, SideCard } from "../../components/StateBlock.tsx"
import { MediaImage } from "@amoeba/ui"
import { fmtAgo, fmtTime, itemKey, mediaUrl, onlineOf, platformOf, PLATFORM_LABEL } from "../../lib/media.ts"
import { openExternalSafely } from "../../lib/host.ts"
import { overlayBlock } from "../../lib/uiOverlay.ts"

export function PlayerPage() {
  const { itemId, from } = usePlayParams()
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

  // ⚠️ 合并 `previewDetail`:二级订阅的单集/房间是**临时预览**出来的(未落库、未建订阅),
  // 只查 allItems 会「找不到这条内容」。队列/下一条也走这份合并表。
  const known = useMemo(
    () => (previewDetail?.items.length ? [...allItems, ...previewDetail.items] : allItems),
    [allItems, previewDetail],
  )
  // ⚠️ `id` 只在订阅内唯一,必须带订阅定位:
  //   ① 预览条目(`preview:*`)是刚抓的快照,比库里同一房间的旧快照新 —— 从该节点进来时优先;
  //   ② 否则按 `?from=` 的订阅精确匹配;
  //   ③ 最后才退回裸 id(理论上只剩「订阅已被删」的兜底)。
  const item = useMemo(() => {
    if (!itemId) return null
    const inPreview =
      previewDetail?.nodeId === from ? previewDetail.items.find((i) => i.id === itemId) : undefined
    const bySub = from ? known.find((i) => i.id === itemId && i.subscriptionId === from) : undefined
    return inPreview ?? bySub ?? known.find((i) => i.id === itemId) ?? null
  }, [known, itemId, from, previewDetail])
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
  const related = useMemo(
    () => (item ? allItems.filter((i) => i.subscriptionId === item.subscriptionId && i.id !== item.id).slice(0, 6) : []),
    [allItems, item],
  )

  // 返回位置：从二级预览里播的，回预览（`?open=`）；否则回来源节点。
  // 预览内容不在库里，回来源节点会丢掉"单集列表"这一层，用户得再点一次节目。
  // ⚠️ 只有**当前这条确实来自预览**才回 `?open=`;previewDetail 不会被清空,
  // 只比 nodeId 的话,同一订阅下播普通条目按返回会被送回上次的预览页。
  const fromPreview = useMemo(
    () => !!item && !!previewDetail && previewDetail.items.some(
      (i) => i.id === item.id && i.subscriptionId === item.subscriptionId,
    ),
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

  if (!item) {
    return (
      <div className="page" {...overlayBlock("player-missing", "player:missing")}>
        <div className="page-scroll scroll-area" {...overlayBlock("player-missing-scroll", "player:missing:scroll")}>
          <StateBlock
            icon="play"
            title="找不到这条内容"
            text="它可能已被刷新替换。回到列表重新选择。"
            actions={
              <button className="btn btn-secondary" onClick={() => navigate(backTo())}>
                <Icon name="back" size={14} /> 返回列表
              </button>
            }
          />
        </div>
      </div>
    )
  }

  const isLive = item.kind === "live"
  const online = onlineOf(item)
  const platform = platformOf(item)
  // 弹幕:设置总开关 × 播放页临时覆盖。关掉时 resolve 结果里的 danmaku 不交给播放器。
  const danmakuOn = danmakuVisible && (settings?.danmakuEnabled ?? true)

  return (
    <div className="player-view" {...overlayBlock("player-view", "player:view")}>
      <header className="detail-head" {...overlayBlock("player-head", "player:head")}>
        <button className="icon-btn sm" aria-label="返回" onClick={() => navigate(backTo())}>
          <Icon name="back" size={15} />
        </button>
        <span className="titlebar-path od-truncate flex-1 min-w-0">
          {item.title}
        </span>
        <button
          className="icon-btn sm"
          aria-label="加入队列"
          onClick={() => addToQueue(item)}
          title="加入队列"
        >
          <Icon name="queue" size={15} />
        </button>
        <button
          className="icon-btn sm"
          aria-label={item.isStarred ? "取消星标" : "星标"}
          aria-pressed={!!item.isStarred}
          onClick={() => toggleStar(item)}
        >
          <Icon name="star" size={15} />
        </button>
      </header>

      <div className="scroll-area player-scroll" {...overlayBlock("player-scroll", "player:scroll")}>
        <div className="player-layout" {...overlayBlock("player-layout", "player:layout")}>
          <div {...overlayBlock("player-main-col", "player:main-col")}>
            <div className="stage" {...overlayBlock("player-stage", "player:stage")}>
              {/* PlayableMedia/VideoShell 自带 relative + aspect-ratio 容器与控件层。
                  ⚠️ **播放器无圆角**(常见播放器都是满幅方角设计)——player 包方角,
                  这里也不再包圆角。stage 只负责宽度上限与居中(见 styles.css .stage)。 */}
              <PlayableMedia
                key={item.id}
                // 统一传 item.id:core 的 findItemUrl 按 id 或 roomId 都能命中条目
                // (直播条目两者不同——`bilibili:6` vs `6`),再取 item.url 去路由。
                // ⚠️ refresh 已带直链时(feed enclosure,如播客)直接给 streams —— 这类
                // item.url 是**网页**(不可 by-url 路由),靠 resolve 必失败。
                streams={(item as { stream?: MediaStream }).stream ? [(item as { stream: MediaStream }).stream] : undefined}
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
                onProgress={(sec, dur) => savePosition(item, sec, dur)}
                // 播完自动下一条:仅当设置开着**且**队列里确实有下一条时。播过的当前条
                // 同时出队(与「播放队列」的语义一致 —— 它是待播列表,不是播放历史)。
                onEnded={() => {
                  if (!(settings?.autoPlayNext ?? true)) return
                  removeFromQueue(item)
                  if (nextInQueue) playTo(nextInQueue.id, from)
                }}
                onError={(err) => useDesktop.getState().toast("error", "播放失败", String(err))}
              />
            </div>

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
                <button className="btn btn-quiet" onClick={() => addToQueue(item)}>
                  <Icon name="queue" size={14} /> 加入队列
                </button>
                {nextInQueue ? (
                  <button className="btn btn-quiet" onClick={() => playTo(nextInQueue.id, from)}>
                    <Icon name="skipForward" size={14} /> 下一条：{nextInQueue.title.slice(0, 16)}
                  </button>
                ) : null}
                {item.url ? (
                  <button className="btn btn-quiet" onClick={() => openExternalSafely(item.url)}>
                    <Icon name="external" size={14} /> 打开原文
                  </button>
                ) : null}
              </div>
            </div>

            {item.summary ? (
              <div className="section-first">
                <SideCard title="简介" icon="info" pad blockKey="player:summary">
                  <p className="t-small t-muted" style={{ lineHeight: 1.7 }}>
                    {item.summary}
                  </p>
                </SideCard>
              </div>
            ) : null}
          </div>

          <aside className="stack" {...overlayBlock("player-side", "player:side")}>
            <SideCard title={`播放队列 ${queueItems.length}`} icon="queue" blockKey="player:queue">
              {queueItems.length === 0 ? (
                <p className="rail-empty">队列为空。在卡片上点 + 加入,或从列表播放。</p>
              ) : (
                <>
                  {queueItems.map((it, i) => (
                    <button
                      key={it.id}
                      className="queue-row"
                      aria-current={it.id === item.id ? "true" : undefined}
                      onClick={() => playTo(it.id, from)}
                    >
                      <span className="queue-rank num">{i + 1}</span>
                      <span className="queue-thumb">
                        <MediaImage src={mediaUrl(it)} ratio={16 / 9} fill />
                      </span>
                      <span className="queue-body">
                        <span className="queue-title od-truncate">{it.title}</span>
                        <span className="queue-sub">{it.author?.name ?? kindName(it.kind)}</span>
                      </span>
                      {it.id === item.id ? (
                        <span className="queue-flag">
                          <Icon name="play" size={12} />
                        </span>
                      ) : null}
                    </button>
                  ))}
                  <div style={{ padding: "var(--sp-2)" }}>
                    <button className="btn btn-quiet btn-block btn-sm" onClick={clearQueue}>
                      <Icon name="trash" size={13} /> 清空队列
                    </button>
                  </div>
                </>
              )}
            </SideCard>

            <SideCard title="来自同一订阅" icon="rss" blockKey="player:related">
              {related.length === 0 ? (
                <p className="rail-empty">该订阅下暂无其它条目。</p>
              ) : (
                related.map((it) => (
                  <button key={it.id} className="queue-row" onClick={() => playTo(it.id, from)}>
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

function kindName(kind: string): string {
  return { article: "文章", video: "视频", audio: "音频", live: "直播", social: "社交" }[kind] ?? kind
}
