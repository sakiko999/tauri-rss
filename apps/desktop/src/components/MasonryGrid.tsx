/**
 * MasonryGrid — social 瀑布流(CSS columns 实现)。
 *
 * 为什么不用 VirtuosoGrid:它假设「same sized items」(等宽等高)做虚拟化,
 * 瀑布流每卡高度不同 → 击穿测量假设。CSS columns 天然**列优先填充**、高度错落,
 * 是真瀑布流;代价是**无虚拟化**——用「递增渲染数 + 底部哨兵」近似无限加载
 * (图片 loading=lazy,离屏不加载,长列表可接受)。
 *
 * 布局:columns-{2..5}(容器宽度断点)+ column-gap;卡片 break-inside-avoid 防跨列截断。
 * 由 MediaList 按 kind 分发(social → 本组件,其余 → VirtuosoGrid)。
 */
import { useEffect, useMemo, useRef, useState } from "react"
import type { MediaItem } from "@tauri-playground/core"

/** 每次滚到底部新增渲染的条数。 */
const PAGE = 20

/** CSS columns 列数(按容器宽度断点,与网格断点一致)。 */
function colsForWidth(w: number): number {
  if (w >= 1152) return 4
  if (w >= 768) return 3
  if (w >= 512) return 2
  return 1
}

export function MasonryGrid({
  items,
  renderItem,
}: {
  items: MediaItem[]
  renderItem: (item: MediaItem) => React.ReactElement
}) {
  // 递增渲染数:初始一页,滚到底 +PAGE。
  const [count, setCount] = useState(() => Math.min(PAGE, items.length))
  const [colCount, setColCount] = useState(1)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  // 数据源变化时重置渲染数(切订阅/刷新)。
  useEffect(() => {
    setCount(Math.min(PAGE, items.length))
  }, [items])

  // 底部哨兵:进入可视 → 增加渲染数(近似无限加载)。图片 lazy 加载,离屏不下载。
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const onVisible = () => setCount((c) => Math.min(c + PAGE, items.length))
    const ro = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onVisible()
      },
      { rootMargin: "600px" }, // 提前加载:距底部 600px 就开始补,滚动不断流
    )
    ro.observe(el)
    return () => ro.disconnect()
  }, [items.length])

  // 容器宽度 → 列数。
  const listRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const calc = () => setColCount(colsForWidth(el.clientWidth))
    calc()
    const ro = new ResizeObserver(calc)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const visible = useMemo(() => items.slice(0, count), [items, count])

  return (
    <div ref={listRef} className="h-full overflow-y-auto px-4">
      {/* 内联 columnCount:CSS columns 列数。不用 Tailwind `columns-{n}` 动态类
          (构建时扫不到)。column-gap 由 columnCount 侧显式设。 */}
      <div style={{ columnCount: colCount, columnGap: "1rem" }}>
        {visible.map((item) => (
          <div key={item.id} className="mb-4 break-inside-avoid">
            {renderItem(item)}
          </div>
        ))}
      </div>
      {/* 底部哨兵:滚近底部触发加载更多。items 全部渲染后不显示。 */}
      {count < items.length && <div ref={sentinelRef} className="h-px" />}
    </div>
  )
}
