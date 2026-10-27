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
import { useEffect, useRef } from "react"
import type { ReactNode } from "react"
import type { MediaItem } from "@amoeba/core"
import { useDesktop } from "../../store/index.ts"
import { Modal } from "../Modal.tsx"
import { itemKey } from "../../lib/media.ts"
import { overlayBlock } from "../../lib/uiOverlay.ts"

export function FocusReader({
  open,
  onOpenChange,
  item,
  onRatio,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: MediaItem | null
  /** 每次滚动后的位置(0..1)。调用方据此在关闭时把三栏归位 ——
   *  只看 store 的 scrollRatio 不够:读到结尾(≥95%)会刻意清掉记录,三栏会弹回顶部。 */
  onRatio?: (ratio: number) => void
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

  // 进度条直接改 DOM 宽度(不走 React 渲染)+ 阅读进度持久化。
  // effect 只随「打开」与条目重挂:滚动事件高频,不因回调/渲染重建监听。
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
      onRatioRef.current?.(ratio)
      const cur = itemRef.current
      if (cur && cur.kind === "article") saveRef.current(cur, ratio)
    }
    // 从三栏当前进度接着读:进专注模式不该回到文章开头。
    const start = itemRef.current?.scrollRatio ?? 0
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
  }, [open, item?.id])

  // ⚠️ 所有 hook 必须在 early return **之前**调用(条目可能被刷新事件换掉)。
  if (!item) return null

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="专注阅读" size="wide" flush>
      <div className="focus-reader" {...overlayBlock("focus-reader", `focus:${itemKey(item)}`)}>
        <div className="focus-progress" aria-hidden>
          <span ref={barRef} />
        </div>
        <div className="focus-scroll scroll-area" ref={scrollRef} {...overlayBlock("focus-scroll", `focus:scroll:${itemKey(item)}`)}>
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
