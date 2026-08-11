/**
 * MediaList — 中栏媒体面板(video/audio/live/social),统一用 `VirtuosoGrid`。
 *
 * 设计:technical-plan 选定 react-virtuoso「一个库覆盖列表/瀑布流/网格」。
 * VirtuosoGrid 内部是 CSS grid → **行优先填充**(第 0..cols-1 个 item 在第一行,
 * 从左到右),虚拟化只渲染可见区,卡片高度自适应(social 图高不一天然错落成瀑布流)。
 * 相比 CSS columns:列优先 + 追加重平衡会让已渲染 item 移位;VirtuosoGrid 无此问题。
 *
 * ⚠️ **gridComponents 必须是模块级稳定身份**(react-virtuoso 硬性要求):
 * 若在组件函数体内 `forwardRef(...)` 定义,每次 re-render 都是**新组件类型**,
 * Virtuoso 会把整列表当卸载重建 → 滚动/测量状态全丢 → 滚动卡住/位置丢失。
 * 因此 GridList/GridItem 提到模块级;列数经模块级 `gridColCountRef` 透传。
 *
 * 响应式列数:GridList 挂载时在 ref 回调里测容器宽度 + 挂 ResizeObserver。
 *
 * 播放解析按 item.subscriptionId 绑定——smart feed 聚合视图下选中节点是
 * smart feed id,不能用于 resolvePlay 查询。
 *
 * 依赖 react-virtuoso(virtualized list/grid 一体化)。
 */
import { forwardRef, useCallback, useEffect, useRef, useState } from "react"
import { VirtuosoGrid, type GridComponents } from "react-virtuoso"
import type { MediaItem } from "@tauri-playground/core"
import { MediaItemView } from "@tauri-playground/ui"
import { cn } from "../lib/cn.ts"
import { isSmartFeed, useDesktop } from "../store.ts"
import { ExpandedPlayer } from "./ExpandedPlayer.tsx"
import { MasonryGrid } from "./MasonryGrid.tsx"

/** 模块级稳定 onOpen:只依赖参数 url,不捕获组件内状态(供 MediaItemView memo 复用)。 */
const openUrl = (url: string) => window.open(url, "_blank")

/** 按容器宽度选列数(Folo 断点):80rem≈1280→5、72rem≈1152→4、48rem≈768→3、32rem≈512→2。 */
function colsForWidth(w: number): number {
  if (w >= 1280) return 5
  if (w >= 1152) return 4
  if (w >= 768) return 3
  if (w >= 512) return 2
  return 1
}

/** 模块级列数(供模块级 GridList 读)。MediaList 每次渲染同步最新 state。 */
let gridColCountRef = 1

/**
 * 模块级 setColCount。Virtuoso 的 RO 回调在模块作用域,不能直接调组件内 setState,
 * 由 MediaList 挂载时注入最新 setter(经 ref 指向当前实例)。
 */
let setColCount: ((n: number) => void) | null = null

/**
 * 模块级稳定 GridList(组件身份只建一次,Virtuoso 依赖它不重建列表)。
 *
 * ⚠️ ref 回调必须是稳定函数:若内联,每次 render 都是新身份,React 会以
 * `null → node` 反复调用 → 每次 disconnect + 重建 ResizeObserver + calc()。
 * Virtuoso 滚动时高频 render,这会造成 RO 反复重建 + setState 风暴 → 滚动卡死。
 * 因此 ref 用 useCallback 稳定;RO 挂载放 useEffect(空依赖,只挂载跑一次)。
 */
const GridList = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function GridList({ style, ...props }, ref) {
    // 组件内 ref 存 DOM node:ref 回调赋值 + 转发给父(Virtuoso 需要)。
    // useCallback 稳定身份 → 不因 render 反复触发(内联会在滚动高频 render 时
    // 反复 null→node,导致 RO 重建 + setState 风暴,滚动卡死)。
    const nodeRef = useRef<HTMLDivElement | null>(null)
    const setRef = useCallback(
      (node: HTMLDivElement | null) => {
        nodeRef.current = node
        if (typeof ref === "function") ref(node)
        else if (ref) ref.current = node
      },
      [ref],
    )
    // RO 只挂载一次(空依赖):挂载测宽 + observe,卸载 disconnect。不随 render 重建。
    useEffect(() => {
      const node = nodeRef.current
      if (!node) return
      const calc = () => setColCount?.(colsForWidth(node.clientWidth))
      calc()
      const ro = new ResizeObserver(calc)
      ro.observe(node)
      return () => ro.disconnect()
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    return (
      <div
        ref={setRef}
        {...props}
        style={{
          ...style,
          display: "flex",
          flexWrap: "wrap",
          alignContent: "flex-start",
          gap: "1rem",
        }}
      />
    )
  },
)

/**
 * 模块级稳定 GridItem。VirtuosoGrid 要求 **same sized items**(等宽)做虚拟化——
 * 官方用 flex-wrap + 等宽百分比 Item。宽度 = 100% / 列数,由模块级 gridColCountRef
 * 决定(MediaList 测容器宽度后同步)。`flex: none` 让 item 不伸缩(等宽)。
 */
const GridItem = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function GridItem({ style, ...props }, ref) {
    return (
      <div
        ref={ref}
        {...props}
        style={{
          ...style,
          flex: "none",
          // 列数对应的等宽百分比(减 gap 分摊)。
          width: `calc(${100 / gridColCountRef}% - ${(gridColCountRef - 1) / gridColCountRef}rem)`,
          boxSizing: "border-box",
        }}
      />
    )
  },
)

/** 模块级稳定 components 对象(Virtuoso 要求 stable identity)。 */
const gridComponents: GridComponents = {
  List: GridList,
  Item: GridItem,
}

export function MediaList({ className }: { className?: string }) {
  const {
    items,
    selectedNodeId,
    loading,
    refresh,
    markRead,
    toggleStar,
    resolvePlay,
    resolveLivePlay,
    refreshErrors,
  } = useDesktop()

  const selectedIsSub = !!selectedNodeId && !isSmartFeed(selectedNodeId)

  // 模态大播放器:展开的视频/直播条目。按 item 快照(展开后列表可能刷新,用当时的
  // resolve 绑定不失效——resolvePlay/resolveLivePlay 是 store 稳定函数)。
  const [expandedItem, setExpandedItem] = useState<MediaItem | null>(null)

  // 响应式列数 state + 模块级接线。RO 回调在模块作用域,setColCount 指向最新 setter。
  const [colCount, setColCountState] = useState(1)
  const setColCountRef = useRef(setColCountState)
  setColCountRef.current = setColCountState
  setColCount = (n) => setColCountRef.current(n)
  // 同步列数到模块级 ref:GridList 渲染时读它(改 gridTemplateColumns → 网格重排)。
  gridColCountRef = colCount

  // 模块级稳定回调:onOpen 只依赖参数 url,可提前绑定。
  const renderItem = (item: (typeof items)[number]) => (
    <MediaItemView
      key={item.id}
      item={item}
      onOpen={openUrl}
      onToggleRead={markRead}
      onToggleStar={toggleStar}
      // 这三个捕获 item;引用变化但行为由 item 决定(item 相同则行为相同),
      // 由 MediaItemView 自定义 memo 比较器跳过比较,不影响 memo 生效。
      onResolvePlay={(itemId) => resolvePlay(item.subscriptionId, itemId)}
      onResolveLivePlay={(roomId) => resolveLivePlay(item.subscriptionId, roomId)}
      onPlayBig={() => setExpandedItem(item)}
    />
  )

  // social 视图:当前选中节点全是 social 条目 → 瀑布流(其余 kind 走网格)。
  const isSocialView = items.length > 0 && items.every((it) => it.kind === "social")

  return (
    // 外层只做布局不滚动(overflow-hidden)——VirtuosoGrid 的 List 自带滚动容器,
    // 若外层也 overflow-y-auto 会出现双滚动条。列表容器 flex-1 min-h-0 撑满剩余高度。
    <main className={cn("flex h-full min-w-0 min-h-0 flex-1 flex-col overflow-hidden p-6", className)}>
      {/* 顶部:当前视图名 + 条数徽章 + 刷新。徽章用实心圆底突出计数。 */}
      <div className="mb-5 flex shrink-0 items-center gap-3">
        <h2 className="text-sm font-semibold text-foreground">内容</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {items.length} 条
        </span>
        {selectedIsSub && (
          <button
            onClick={() => refresh(selectedNodeId!)}
            disabled={loading}
            className="ml-auto rounded-md border border-border px-3 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            刷新
          </button>
        )}
        {refreshErrors[selectedNodeId ?? ""] && (
          <span className="text-sm text-destructive">{refreshErrors[selectedNodeId!]}</span>
        )}
      </div>

      <div className="min-h-0 flex-1">
        {items.length === 0 && !loading ? (
          <p className="text-sm text-muted-foreground">暂无内容</p>
        ) : isSocialView ? (
          /* social → 瀑布流(CSS columns + 无限加载)。图为主、高度不一,瀑布流最自然。
             VirtuosoGrid 假设等尺寸 item 承载不了变高瀑布流,故独立实现。 */
          <MasonryGrid items={items} renderItem={renderItem} />
        ) : (
          /* 其余 kind → VirtuosoGrid 虚拟化网格。 */
          <VirtuosoGrid
            totalCount={items.length}
            components={gridComponents}
            itemContent={(index) => renderItem(items[index])}
          />
        )}
      </div>

      {/* 模态大播放器:点击「大屏播放」打开。闭包绑定当时的 item + resolve。 */}
      {expandedItem && (
        <ExpandedPlayer
          item={expandedItem}
          resolvePlay={(itemId) => resolvePlay(expandedItem.subscriptionId, itemId)}
          resolveLivePlay={(roomId) => resolveLivePlay(expandedItem.subscriptionId, roomId)}
          onClose={() => setExpandedItem(null)}
        />
      )}
    </main>
  )
}
