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
import { useEffect, useMemo } from "react"
import { PlayableMedia } from "@tauri-playground/player"
import type { MediaItem } from "@tauri-playground/core"
import { useDesktop } from "../../store/index.ts"
import { usePlayNavigate, usePlayParams, useViewNavigate } from "../../router.tsx"
import { Icon } from "../../components/Icon.tsx"
import { StateBlock, SideCard } from "../../components/StateBlock.tsx"
import { MediaImage } from "@tauri-playground/ui"
import { fmtAgo, fmtTime, mediaUrl, onlineOf, platformOf, PLATFORM_LABEL } from "../../lib/media.ts"
import { openExternalSafely } from "../../lib/host.ts"

export function PlayerPage() {
  const { itemId, from } = usePlayParams()
  const allItems = useDesktop((s) => s.allItems)
  const queue = useDesktop((s) => s.queue)
  const resolvePlay = useDesktop((s) => s.resolvePlay)
  const resolveLivePlay = useDesktop((s) => s.resolveLivePlay)
  const addToQueue = useDesktop((s) => s.addToQueue)
  const clearQueue = useDesktop((s) => s.clearQueue)
  const toggleStar = useDesktop((s) => s.toggleStar)
  const savePosition = useDesktop((s) => s.savePosition)
  const danmakuVisible = useDesktop((s) => s.danmakuVisible)
  const toggleDanmaku = useDesktop((s) => s.toggleDanmaku)
  const settings = useDesktop((s) => s.settings)
  const go = useViewNavigate()
  // ⚠️ 播放页内跳向另一条内容必须走 /play/:itemId。用 go("play:"+id) 会生成
  // `/v/play%3Aid`,App 的 isPlay 判的是 params.itemId → 落到 MediaMain 网格。
  const playTo = usePlayNavigate()

  const item = useMemo(() => allItems.find((i) => i.id === itemId) ?? null, [allItems, itemId])
  const queueItems = useMemo(
    () => queue.map((id) => allItems.find((i) => i.id === id)).filter((x): x is MediaItem => !!x),
    [queue, allItems],
  )
  const related = useMemo(
    () => (item ? allItems.filter((i) => i.subscriptionId === item.subscriptionId && i.id !== item.id).slice(0, 6) : []),
    [allItems, item],
  )

  // 播放页按键:Esc 返回;←/→ 交给播放器控件;空格由播放器处理。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") go(from ?? "tab:all")
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [go, from])

  // 播放队列里的下一条。
  const nextInQueue = useMemo(() => {
    if (!item) return null
    const idx = queue.findIndex((id) => id === item.id)
    if (idx >= 0) return queue[idx + 1] ? allItems.find((i) => i.id === queue[idx + 1]) ?? null : null
    return null
  }, [queue, item, allItems])

  if (!item) {
    return (
      <div className="page">
        <div className="page-scroll scroll-area">
          <StateBlock
            icon="play"
            title="找不到这条内容"
            text="它可能已被刷新替换。回到列表重新选择。"
            actions={
              <button className="btn btn-secondary" onClick={() => go(from ?? "tab:all")}>
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
    <div className="player-view">
      <header className="detail-head">
        <button className="icon-btn sm" aria-label="返回" onClick={() => go(from ?? "tab:all")}>
          <Icon name="back" size={15} />
        </button>
        <span className="titlebar-path od-truncate" style={{ flex: 1, minWidth: 0 }}>
          {item.title}
        </span>
        <button
          className="icon-btn sm"
          aria-label="加入队列"
          onClick={() => addToQueue(item.id)}
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

      <div className="scroll-area player-scroll">
        <div className="player-layout">
          <div>
            <div className="stage">
              {/* PlayableMedia/VideoShell 自带 relative + aspect-ratio 容器与控件层。
                  ⚠️ **播放器无圆角**(常见播放器都是满幅方角设计)——player 包方角,
                  这里也不再包圆角。stage 只负责宽度上限与居中(见 styles.css .stage)。 */}
              <PlayableMedia
                key={item.id}
                // 统一传 item.id:core 的 findItemUrl 按 id 或 roomId 都能命中条目
                // (直播条目两者不同——`bilibili:6` vs `6`),再取 item.url 去路由。
                resolve={() =>
                  isLive
                    ? resolveLivePlay(item.subscriptionId, item.id)
                    : resolvePlay(item.subscriptionId, item.id)
                }
                autoResolve={settings?.autoplayVideo ?? true}
                // 弹幕总开关关闭时不建弹幕连接(而非建了再藏)。
                showDanmaku={danmakuOn}
                // 续播:非直播才有位置语义(item.positionSec 由 core 从 reading 回填)。
                startAtSec={isLive ? undefined : item.positionSec}
                onProgress={(sec, dur) => savePosition(item, sec, dur)}
                onError={(err) => useDesktop.getState().toast("error", "播放失败", String(err))}
              />
            </div>

            <div className="player-meta">
              <h1 className="player-title">{item.title}</h1>
              <div className="player-sub">
                {isLive ? (
                  <span className="tag tag-live">● 直播中</span>
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
                <button className="btn btn-secondary" aria-pressed={danmakuOn} onClick={toggleDanmaku}>
                  <Icon name="captions" size={14} /> 弹幕{danmakuOn ? "开" : "关"}
                </button>
                <button className="btn btn-quiet" onClick={() => addToQueue(item.id)}>
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
                <SideCard title="简介" icon="info" pad>
                  <p className="t-small t-muted" style={{ lineHeight: 1.7 }}>
                    {item.summary}
                  </p>
                </SideCard>
              </div>
            ) : null}
          </div>

          <aside className="stack">
            <SideCard title={`播放队列 ${queueItems.length}`} icon="queue">
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

            <SideCard title="来自同一订阅" icon="rss">
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
