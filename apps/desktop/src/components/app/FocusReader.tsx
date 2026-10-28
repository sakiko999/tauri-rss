/**
 * FocusReader —— 专注阅读浮层(合流改版 M4)。
 *
 * 把阅读三栏里的那篇文章原样搬进一个无干扰、可滚动的浮层:顶部一条滚动进度,
 * Esc / 右上角关闭按钮退出。行宽与字号仍由 `--article-fs` 与 `data-measure` 控制
 * (复用 `.article` / `.article-body`,不另立一套排版)。
 *
 * ⚠️ 正文由调用方(ReaderMain)以 children 传入 —— 那是**同一棵已消毒的节点**
 * (标题 / 署名 / 标签 / 正文 / 页脚都在里面)。这里**不**跑第二遍 DOMPurify:
 * 两份配置迟早漂移,漏掉一个标签就是一处 XSS 面;标题与署名也不会两处写成两个样。
 *
 * ⚠️ 滚动进度**只有一个写者**:打开期间 ReaderMain 的三栏被门控关掉写回
 * (focusOpenRef),本组件独占写 saveScrollRatio;关闭时 ReaderMain 把三栏对到
 * 同一进度。两个容器各写一份会互相覆盖 —— 阅读进度是同一 readingKey 上的一个值。
 */

import type { MediaItem } from "@amoeba/core"
import { useEffect, useRef } from "react"
import type { ReactNode } from "react"

import { itemKey } from "../../lib/media.ts"
import { overlayBlock } from "../../lib/uiOverlay.ts"
import { useDesktop } from "../../store/index.ts"
import { Modal } from "../Modal.tsx"

export function FocusReader({
  open,
  onOpenChange,
  item,
  onRatio,
  contentVersion = 0,
  startRatio = null,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: MediaItem | null
  /** 每次滚动后的位置(0..1)。调用方据此在关闭时把三栏归位 ——
   *  只看 store 的 scrollRatio 不够:读到结尾(≥95%)会刻意清掉记录,三栏会弹回顶部。 */
  onRatio?: (ratio: number) => void
  /**
   * 正文本版本号(调用方传「已补全 ? 正文长度 : 0」)。
   * ⚠️ 补全正文是异步到达的:item.id 不变但容器高度涨数倍,不按新高度重定位
   * 就会停在旧像素处(视线跳回前段),随后任意一次滚动还会把这个错位当新进度写回。
   */
  contentVersion?: number
  /** 打开那一刻三栏的真实滚动比例(读到 ≥95% 时 store 已清记录,必须由调用方量)。 */
  startRatio?: number | null
  /** ReaderMain 拼好的文章内容节点(已消毒的正文 + 标题/署名/标签/页脚)。 */
  children: ReactNode
}) {
  const saveScrollRatio = useDesktop((s) => s.saveScrollRatio)
  const scrollRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLSpanElement>(null)
  const itemRef = useRef(item)
  itemRef.current = item
  const saveRef = useRef(saveScrollRatio)
  saveRef.current = saveScrollRatio
  // 回调走 ref:effect 只随「打开 / 条目」重挂,不能因父组件每次渲染换新箭头而重建监听。
  const onRatioRef = useRef(onRatio)
  onRatioRef.current = onRatio
  /** 本轮的滚动比例:正文补全后按它把位置换算到新高度(不能回退到 store 值)。 */
  const lastRatioRef = useRef<number | null>(null)
  /** 上一次 effect 运行时浮层是否已开:只有「刚打开」才用调用方量的 startRatio。 */
  const wasOpenRef = useRef(false)

  // 关闭 / 换条目时丢弃上一轮的进度记录(见下方 effect 的 start 取值顺序)。
  useEffect(() => {
    lastRatioRef.current = null
    if (!open) wasOpenRef.current = false
  }, [open, item?.id])

  // 进度条直接改 DOM 宽度(不走 React 渲染)+ 阅读进度持久化。
  // effect 随「打开 / 条目 / 正文补全」重挂:滚动事件高频,不因回调/渲染重建监听。
  useEffect(() => {
    if (!open) return
    const el = scrollRef.current
    const bar = barRef.current
    if (!el) return
    /**
     * ⚠️ 恢复完成前不写回:浮层每次打开都是全新的滚动容器(scrollTop 从 0 起),
     * 此时先让 onScroll 记一次 0% 会把已存进度抹掉(与 ReaderMain 的
     * pendingRestoreRef 同一类事故,那里记的是「切条目时写回上一条的位置」)。
     */
    let restoring = true
    const sync = () => {
      const max = el.scrollHeight - el.clientHeight
      const ratio = max > 0 ? Math.min(1, el.scrollTop / max) : 0
      if (bar) bar.style.width = `${ratio * 100}%`
      if (restoring) return
      lastRatioRef.current = ratio
      onRatioRef.current?.(ratio)
      const cur = itemRef.current
      if (cur && cur.kind === "article") saveRef.current(cur, ratio)
    }
    // 从三栏当前进度接着读:进专注模式不该回到文章开头。
    // 取值顺序:刚打开 → 调用方从三栏量出来的 startRatio(store 在 ≥95% 时已清记录);
    // 补全后重跑 → 本轮已爬到的位置;换条目 → 新条目自己的进度。
    const start = (!wasOpenRef.current ? startRatio : null) ?? lastRatioRef.current ?? itemRef.current?.scrollRatio ?? 0
    wasOpenRef.current = true
    const raf = requestAnimationFrame(() => {
      const max = el.scrollHeight - el.clientHeight
      el.scrollTo({ top: start > 0.02 && max > 0 ? start * max : 0 })
      restoring = false
      sync()
    })
    el.addEventListener("scroll", sync, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener("scroll", sync)
    }
  }, [open, item?.id, contentVersion, startRatio])

  // ⚠️ 所有 hook 必须在 early return **之前**调用(条目可能被刷新事件换掉)。
  if (!item) return null

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="专注阅读" size="wide" flush>
      <div className="focus-reader" {...overlayBlock("focus-reader", `focus:${itemKey(item)}`)}>
        <div className="focus-progress" aria-hidden>
          <span ref={barRef} />
        </div>
        <div
          className="focus-scroll scroll-area"
          ref={scrollRef}
          {...overlayBlock("focus-scroll", `focus:scroll:${itemKey(item)}`)}
        >
          <article
            className="article focus-article"
            {...overlayBlock("focus-article", `focus:article:${itemKey(item)}`)}
          >
            {children}
          </article>
        </div>
      </div>
    </Modal>
  )
}
