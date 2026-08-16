/**
 * MasonryGrid — social 瀑布流(masonic 虚拟化)。
 *
 * 背景:CSS columns 是「多列共享容器 + 列平衡重排」——追加重排,已渲染卡片会移位。
 * 换 **masonic**(jaredLunde):position cache 只给新 item 分配位置,追加时已有卡片
 * **原地不动**(用 usePositioner,items 变化不重建);且**虚拟化**——只渲染视口内的
 * cell(与 VirtuosoGrid 口径一致),千条也不堆 DOM。
 *
 * 关键集成点:
 *  - **内层滚动容器**:masonic 默认绑定 window 滚动,我们 MasonryGrid 是内层
 *    `overflow-y-auto`——用 `usePositioner + useMasonry` 手动喂容器 `scrollTop/height`。
 *  - **追加 vs 替换**:append(loadMore) 保持 positioner(追加稳定);refresh(items 整体
 *    替换,前段引用不同)重建 positioner(layoutVersion 递增),防索引错位。
 *  - **高度稳定**:crawler 已预取图片宽高 → MediaImage 设 aspect-ratio,cell 高稳定;
 *    ⚠️ 但估算(文本折行等)有偏差 → 用「预置估算防空白 + 渲染后测量真实高度修正」兜底,
 *    见下方预置/测量段(不是「一次到位无需二次校准」)。
 */
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react"
import { useMasonry, usePositioner } from "masonic"
import type { MediaItem } from "@tauri-playground/core"
import { LoadMoreFooter } from "./LoadMoreFooter.tsx"
import { isSmartFeed, isTabNode, useDesktop } from "../store.ts"

/** CSS columns 列数(按容器宽度断点,与网格断点一致)。 */
function colsForWidth(w: number): number {
  if (w >= 1152) return 4
  if (w >= 768) return 3
  if (w >= 512) return 2
  return 1
}

/**
 * 单 item 高度估算:图片比例 + 数量 + 列宽 + 文本行数粗算。
 * 贴近 SocialRenderer 实际结构:卡片 p-3(24) + 文本行×行高(23,text-sm leading-relaxed
 * 实际 ~22.75,line-clamp-6 截断) + gap(10×2) + 图(占满列宽,比例撑高,多图纵向 + 8 gap)
 * + 底栏(30) + 余量(6)。**无图时不占图高**(纯文本卡不被高估)。图宽高未知退化 4:3。
 * 文本行保险 +1:宁多估(留白)勿少估(内容溢出重叠)。
 * ⚠️ 此估算只作**首帧占位**——渲染后「测量修正」读真实 offsetHeight 覆盖,偏差被吸收,
 * 但估算越准,测量修正的重排幅度越小,视觉越稳。
 */
function estimateItemHeight(it: MediaItem, colW: number): number {
  const imgs = (it as { images?: Array<{ width?: number; height?: number }> }).images ?? []
  // 多图:每张按各自比例累加(图间 gap 8)——单用第一张会低估后续高图。
  let imgH = 0
  for (const img of imgs) {
    if (img?.width && img?.height) imgH += (colW * img.height) / img.width
    else imgH += colW * 0.75
  }
  const content = (it as { content?: string }).content ?? ""
  // 文本渲染宽粗算:中文/全角/emoji(码点>0xFFFF,微博正文常见)≈ 14px(14px 字号)、
  // 英文/数字/空格 ≈ 7.7px;line-clamp-6 截断。
  // ⚠️ 不做行保险:估偏大 → 测量修正普遍触发 → positioner.update 重排同列后续 → 底部
  // 卡片位置变化。估算贴近真实 → 测量修正几乎不触发(±1px 才 update)→ 位置稳定;
  // 折行等残余偏差由「渲染后测量修正」兜底(高度变准,不重叠)。
  const textW = [...content].reduce(
    (w, ch) => w + (ch.codePointAt(0)! > 0xffff || /[一-鿿　-〿＀-￯]/.test(ch) ? 14 : 7.7),
    0,
  )
  const lines = content ? Math.min(6, Math.max(1, Math.ceil(textW / colW))) : 0
  // 卡片结构:p-3(24) + 底栏(30) + gap(flex gap-2.5=10,文本↔图↔底栏之间;按实际结构
  // 计:图+文本=2 gap、仅其一=1 gap、无=0)+ 余量(6 防裁切)。结构不精确会普遍偏大 → 修正多。
  const hasImg = imgs.length > 0
  const hasText = lines > 0
  const gap = hasImg && hasText ? 20 : hasImg || hasText ? 10 : 0
  return imgH + Math.max(0, imgs.length - 1) * 8 + lines * 23 + 24 + 30 + gap + 6
}

/** 水平 padding(滚动容器 px-4 = 两侧各 1rem)——positioner 宽度按内容宽算,否则列溢出。 */
const H_PADDING = 32
/** 预加载边距:渲染窗口距已加载末尾不足该 cell 数即触发 loadMore(列/网格还有空间可填)。
 * 取大(≈2 屏)让追加点远离视口底部——追加在可视区外,滚动到时内容已就绪,不闪不空白。 */
const PRELOAD_MARGIN = 16

export function MasonryGrid({
  items,
  renderItem,
}: {
  items: MediaItem[]
  renderItem: (item: MediaItem) => React.ReactElement
}) {
  // 内层滚动容器 + 可视区尺寸 + 滚动位置(手动喂 masonic)。
  const scrollRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [scrollTop, setScrollTop] = useState(0)
  // 布局版本:refresh(items 替换)时 +1 重建 positioner;append 不动 → 追加稳定。
  const [layoutVersion, setLayoutVersion] = useState(0)

  // 翻页状态(自订阅 store;onRender 预加载用,替代「滚动到底 Footer IO」——按列空间触发)。
  const selectedNodeId = useDesktop((s) => s.selectedNodeId)
  const canLoadMore = useDesktop((s) => s.canLoadMore)
  const loadMoreEnded = useDesktop((s) => s.loadMoreEnded)
  const loadingMore = useDesktop((s) => s.loadingMore)
  const loadMore = useDesktop((s) => s.loadMore)
  const nodeId = selectedNodeId ?? ""
  const canPage = !!nodeId && !isSmartFeed(nodeId) && !isTabNode(nodeId) && !!canLoadMore[nodeId]
  const ended = !!loadMoreEnded[nodeId]
  const loadingRef = useRef(loadingMore)
  loadingRef.current = loadingMore
  // 无进展保护:记录最近一次触发 loadMore 时的 items.length——loadMore 失败/空页(items
  // 不增长)时禁止反复触发,否则滚动中同一批数据被反复请求(「超大量重复请求」)。
  const lastTriggerLenRef = useRef(-1)

  // 容器尺寸(ResizeObserver 观察滚动容器;宽度减水平 padding 得内容宽)。
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const calc = () => setSize({ width: Math.max(0, el.clientWidth - H_PADDING), height: el.clientHeight })
    calc()
    const ro = new ResizeObserver(calc)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 追加 vs 替换:append = 新 items 前段引用与旧相同 → 不动 positioner(追加稳定);
  // 替换(refresh/切源) → layoutVersion++ → usePositioner deps 变 → 重建 positioner。
  const prevItemsRef = useRef(items)
  useEffect(() => {
    const prev = prevItemsRef.current
    const appended = prev.length <= items.length && prev.every((it, i) => items[i] === it)
    if (!appended) setLayoutVersion((v) => v + 1)
    prevItemsRef.current = items
  }, [items])

  // positioner 决定列数/列宽 + 每 cell 位置。deps=[width, layoutVersion]:
  //  resize 跨断点/refresh 时重建(重排不可避免);items append 不触发。
  const positioner = usePositioner(
    {
      width: size.width,
      columnCount: size.width ? colsForWidth(size.width) : 1,
      columnGutter: 16,
      rowGutter: 16,
    },
    [size.width, layoutVersion],
  )

  // 列宽 + 平均高度估算(给 masonic itemHeightEstimate——新 item 落位用)。
  const colCount = size.width ? colsForWidth(size.width) : 1
  const colW = Math.max(1, (size.width - (colCount - 1) * 16) / colCount)
  const estHeight = useMemo(() => {
    if (!items.length) return 320
    return items.reduce((sum, it) => sum + estimateItemHeight(it, colW), 0) / items.length
  }, [items, colW])

  // ⚠️ 预置新增 item 到 positioner(per-item 估算高):masonic 的 fresh batch 对未测量
  // cell 用「无定位样式」(只 width+absolute,无 top/left)渲染 → 堆叠容器顶部 → 视口
  // 底部空白,滚动才恢复。预置后 measuredCount==itemCount → 不触发 fresh batch → 新
  // item 有位置渲染(无空白);且 setItemRef 检测到已有位置 + 未传 resizeObserver → 不
  // 自行测量。副带收益:intervalTree 覆盖全部 item → 容器总高 = 最高列实际高度,滚动
  // 条长度准确。
  // 用 **useLayoutEffect**(DOM commit 后、绘制前同步):预置 + forceUpdate 在用户看到
  // 任何东西之前完成,首帧即全量定位 —— useEffect 会先画一帧空白/堆叠再修正(闪)。
  // ⚠️ 高度由下方「渲染后测量修正」覆盖估算(卡片已去 h-full,自然高=真实内容高),
  // 估算只作首帧占位——偏差被测量修正吸收,不产生布局问题。
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0)
  useLayoutEffect(() => {
    let changed = false
    for (let i = 0; i < items.length; i++) {
      if (positioner.get(i) === undefined) {
        positioner.set(i, estimateItemHeight(items[i], colW))
        changed = true
      }
    }
    if (changed) forceUpdate()
  }, [items, positioner, colW, forceUpdate])

  // ── 渲染后测量修正 ──────────────────────────────────────────────
  // 预置把 cell 高度固定为估算 → 估算偏差(文本折行/字号)导致「累积列高失真」→ 后续
  // cell 位置错乱 + 内容溢出重叠。修:渲染后读已挂载 cell 的真实 offsetHeight(卡片去
  // h-full 后自然高 = 真实内容高;aspect-ratio 图容器高度不依赖图片加载)→ positioner
  // .update 重排。无依赖 + useLayoutEffect:每次提交后都核对,但只处理**未测量过**的
  // index(实测过的缓存),滚动重渲染零操作,不进入循环;update + forceUpdate 在**绘制
  // 前**同步完成 → 用户只看到修正后的最终布局,不闪。
  const cellElsRef = useRef(new Map<number, HTMLElement>())
  const measuredIdxRef = useRef(new Set<number>())
  const positionerRef = useRef(positioner)
  const setCellRef = (index: number) => (el: HTMLElement | null) => {
    if (el) cellElsRef.current.set(index, el)
    else cellElsRef.current.delete(index) // 卸载时释放引用,防滚动累积 DOM 泄漏
  }
  // 布局版本变化(refresh 重建 positioner)→ 清空测量记录,重新核对。
  useEffect(() => {
    measuredIdxRef.current.clear()
  }, [layoutVersion])
  useLayoutEffect(() => {
    // 跨断点 resize:usePositioner deps(width)变 → positioner 重建,旧测量(旧列宽下高度)
    // 失效 → 检测引用变化清空,下次全量重测。
    if (positionerRef.current !== positioner) {
      positionerRef.current = positioner
      measuredIdxRef.current.clear()
    }
    // masonic 的 update 收**扁平数组** [index, height, index, height, ...](非二元组数组)。
    const updates: number[] = []
    cellElsRef.current.forEach((el, index) => {
      // isConnected:虚拟化滚出视口的 cell 已卸载(旧 el 失效),跳过(用旧测量)。
      if (measuredIdxRef.current.has(index) || !el.isConnected) return
      measuredIdxRef.current.add(index)
      const real = el.offsetHeight
      const pos = positioner.get(index)
      if (pos && Math.abs(pos.height - real) > 1) updates.push(index, real)
    })
    if (updates.length) {
      positioner.update(updates)
      forceUpdate()
    }
  })

  const grid = useMasonry({
    positioner,
    items,
    itemKey: (it) => it.id,
    itemHeightEstimate: estHeight,
    overscanBy: 2,
    height: size.height,
    scrollTop,
    onRender: (_start, stop, _rendered) => {
      // 渲染窗口逼近已加载末尾 = 列/网格还有空白空间 → 预加载填列(新 item 落最短列)。
      // 比「滚动到底 Footer IO」更提前、按列空间感知;loadingRef 防重入,ended 停。
      if (canPage && !ended && !loadingRef.current && items.length > 0) {
        if (stop + PRELOAD_MARGIN >= items.length - 1 && lastTriggerLenRef.current !== items.length) {
          lastTriggerLenRef.current = items.length
          loadMore()
        }
      }
    },
    render: ({ data, index }) => (
      // 包一层 div 收集 cell 引用,渲染后测量真实高度修正估算。不 delete map:滚出视口
      // 卸载时旧 el 失联(isConnected=false),测量跳过;滚回重挂后 set 新 el 仍用旧测量。
      <div ref={setCellRef(index)}>{renderItem(data)}</div>
    ),
  })

  return (
    // 外层布局容器(MediaList 要求 overflow-hidden,滚动在此 div 内)。
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto px-4"
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      {grid}
      {/* 订阅「加载更多」:主触发是上方 onRender(渲染窗口逼近末尾=列空白预载);Footer 保留
          「加载更多」按钮 + 滚动到底 IO 兜底 + 已加载全部终态。聚合视图内部渲染空 div。 */}
      <LoadMoreFooter />
    </div>
  )
}
