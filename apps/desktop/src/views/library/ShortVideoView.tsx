/**
 * ShortVideoView —— 第三模式：短视频全屏上下滑流。
 *
 * 设计取舍（曾评估 Swiper，最终不引）：
 * - **不引 Swiper**：竖向整页滑动用原生 **CSS scroll-snap**（`snap-y snap-mandatory`
 *   + 每屏 `snap-start h-full`）—— 零依赖、滚动手感由浏览器保证、键盘/触控/滚轮全支持。
 *   Swiper 的 Cube/Flip 3D 转场是加分项，但本模式只需要「一屏一条」，原生足够。
 * - **只挂当前条**：`IntersectionObserver` 标记哪一条在屏，**仅当前条**挂载
 *   `PlayableMedia`（其余显示 poster 占位）—— ⚠️ 曾挂「当前 ±1」三条，但 `PlayableMedia`
 *   挂载即带声自动播、无「预加载不播」开关 → 三条同时出声 + 三路弹幕 WS。改为只挂当前。
 * - **非当前自动暂停 = 卸载**：滑走后该条离屏 → `active` 变 false → 卸载 `PlayableMedia`
 *   （重挂即停），回来重新懒解析（有缓存）。⚠️ `PlayableMedia` 靠 key 重挂会重解析、代价大，
 *   但「保留实例只暂停」需给它加命令式 pause API（当前没有，不做）。
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { PlayableMedia } from "@amoeba/player"
import { MediaImage } from "@amoeba/ui"
import type { MediaItem } from "@amoeba/core"
import { useDesktop } from "../../store/index.ts"
import { Icon } from "../../components/Icon.tsx"
import { useViewNavigate } from "../../router.tsx"
import { itemKey } from "../../lib/media.ts"
import { scrollBehavior } from "../../lib/motion.ts"
import { openExternalSafely } from "../../lib/host.ts"
import { overlayBlock } from "../../lib/uiOverlay.ts"

/** 单个 slide。active=false 时只渲染 poster 占位（不挂播放器）。 */
function Slide({ item, index, active, onClose }: { item: MediaItem; index: number; active: boolean; onClose: () => void }) {
  const resolvePlay = useDesktop((s) => s.resolvePlay)
  const resolveLivePlay = useDesktop((s) => s.resolveLivePlay)
  const savePosition = useDesktop((s) => s.savePosition)
  const isLive = item.kind === "live"
  const playable = item.kind === "video" || item.kind === "audio" || item.kind === "live"

  return (
    <section
      className="sv-slide snap-start"
      data-item={item.id}
      data-index={index}
      {...overlayBlock("shortvideo-slide", `shortvideo:slide:${itemKey(item)}`)}
    >
      {playable && active ? (
        <PlayableMedia
          key={item.id}
          className="sv-media"
          streams={(item as { stream?: import("@amoeba/core").MediaStream }).stream ? [(item as { stream: import("@amoeba/core").MediaStream }).stream] : undefined}
          resolve={() =>
            isLive ? resolveLivePlay(item.subscriptionId, item.id) : resolvePlay(item.subscriptionId, item.id)
          }
          startAtSec={isLive ? undefined : item.positionSec}
          onProgress={(sec, dur) => savePosition(item, sec, dur)}
        />
      ) : (
        <div className="sv-poster">
          {item.poster || item.thumbnail ? (
            <MediaImage src={item.poster ?? item.thumbnail} ratio={9 / 16} className="h-full w-full" fill />
          ) : (
            <Icon name="play" size={40} />
          )}
        </div>
      )}
      <div className="sv-overlay" {...overlayBlock("shortvideo-overlay", `shortvideo:overlay:${itemKey(item)}`)}>
        <div className="sv-info">
          <span className="sv-title">{item.title}</span>
          {item.author?.name ? <span className="sv-author">{item.author.name}</span> : null}
          {isLive ? <span className="tag tag-live">● 直播</span> : null}
        </div>
        <div className="sv-actions">
          <button className="sv-act" aria-label="打开原文" onClick={() => openExternalSafely(item.url)}>
            <Icon name="external" size={18} />
          </button>
          <button className="sv-act" aria-label="退出短视频" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>
      </div>
    </section>
  )
}

export function ShortVideoView() {
  const nodeId = useDesktop((s) => s.selectedNodeId)
  const view = useDesktop((s) => s.view)
  const growPage = useDesktop((s) => s.growPage)
  const go = useViewNavigate()
  const containerRef = useRef<HTMLDivElement>(null)
  const [activeIdx, setActiveIdx] = useState(0)
  // 退出目标 = 同类内容 tab(short:video → tab:video)。⚠️ 旧实现 `go(nodeId)` 的
  // nodeId 就是当前 `short:*` 节点 → 导航到当前位置 = 无操作,退出按钮是死键(且 Esc
  // 也没绑定),进了短视频模式只能点侧栏才出得来。
  const exit = () => {
    const k = (nodeId ?? "short:all").slice(6) // `short:` 之后
    go(k && k !== "all" ? `tab:${k}` : "tab:all")
  }

  // ⚠️ view.list 是分页窗口(≤ PAGE_SIZE 60)。该视图不挂 LoadMoreFooter/不做触底翻页
  // → 第 61 条起滑不到。滑到接近末尾时自动 growPage 放窗口(与其他视图的触底预载等价)。
  const items = useMemo(() => view.list, [view.list])
  useEffect(() => {
    if (view.hasMore && items.length > 0 && activeIdx >= items.length - 3) growPage(nodeId ?? "")
  }, [activeIdx, items.length, view.hasMore, nodeId, growPage])

  // IntersectionObserver 跟踪「哪一屏在视口中央」→ activeIdx。
  useEffect(() => {
    const root = containerRef.current
    if (!root) return
    const slides = [...root.querySelectorAll<HTMLElement>(".sv-slide")]
    if (slides.length === 0) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio > 0.6) {
            const idx = Number((e.target as HTMLElement).dataset.index ?? "0")
            setActiveIdx(idx)
          }
        }
      },
      { root, threshold: [0.6] },
    )
    slides.forEach((s) => io.observe(s))
    return () => io.disconnect()
  }, [items.length])

  // 键盘：↑/↓ 切上下条（滚动到对应屏）；Esc 退出短视频。
  const scrollTo = (i: number) => {
    const clamped = Math.max(0, Math.min(items.length - 1, i))
    containerRef.current?.querySelectorAll<HTMLElement>(".sv-slide")[clamped]?.scrollIntoView({ behavior: scrollBehavior() })
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || useDesktop.getState().paletteOpen) return
      if (e.key === "Escape") {
        e.preventDefault()
        exit()
      } else if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault()
        scrollTo(activeIdx + 1)
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault()
        scrollTo(activeIdx - 1)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [activeIdx, items.length, nodeId])

  if (items.length === 0) {
    return (
      <div className="sv-empty" {...overlayBlock("shortvideo-empty", "shortvideo:empty")}>
        <Icon name="play" size={32} />
        <p>这个视图没有可播放的条目。</p>
        <p className="t-dim t-small">短视频模式只收 video / audio / live 三类。</p>
      </div>
    )
  }

  return (
    <div className="shortvideo" ref={containerRef} {...overlayBlock("shortvideo", "shortvideo:root")}>
      {items.map((it, i) => (
        <div key={itemKey(it, i)} className="sv-slot">
          <Slide item={it} index={i} active={i === activeIdx} onClose={exit} />
        </div>
      ))}
      <span className="sv-hint t-micro">
        {activeIdx + 1} / {items.length} · ↑↓ 切换
      </span>
    </div>
  )
}
