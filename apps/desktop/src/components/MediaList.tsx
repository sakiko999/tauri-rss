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
import { RefreshCw, Loader2 } from "lucide-react"
import type { MediaItem, SocialItem } from "@tauri-playground/core"
import { SocialRenderer, UnifiedCard } from "@tauri-playground/ui"
import { unlockAudioPlayback } from "@tauri-playground/player"
import { cn } from "../lib/cn.ts"
import { isSmartFeed, isTabNode, useDesktop, viewTitleFor } from "../store.ts"
import { ExpandedPlayer } from "./ExpandedPlayer.tsx"
import { MasonryGrid } from "./MasonryGrid.tsx"

/** 模块级稳定 onOpen:只依赖参数 url,不捕获组件内状态(供 UnifiedCard memo 复用)。 */
const openUrl = (url: string) => window.open(url, "_blank")

/** 按容器宽度选列数(Folo 断点):80rem≈1280→5、72rem≈1152→4、48rem≈768→3、32rem≈512→2。
 * video/live 统一中卡(16:9 图在上),按正常断点,不再对 live 限 2 列。 */
function colsForWidth(w: number): number {
  return w >= 1280 ? 5 : w >= 1152 ? 4 : w >= 768 ? 3 : w >= 512 ? 2 : 1
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
          // 水平 padding 统一到容器(左右对称 px-3):卡片无水平 padding,滚动条不压内容。
          paddingLeft: "1rem",
          paddingRight: "1rem",
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

/**
 * 模块级稳定 Footer(加载更多)。**自己订阅 useDesktop**——visible/loading/ended 变化由
 * zustand 驱动 re-render(不走模块级变量:Virtuoso 只在 totalCount 变化时重建 Footer,
 * 模块级变量变化不触发它,曾致按钮空白)。触底自动加载:Footer 进入视口(提前 200px)
 * 即翻页(无限滚动,不依赖 VirtuosoGrid endReached——实测 Grid 下未触发);按钮保留作手动兜底。
 */
function LoadMoreFooter() {
  const selectedNodeId = useDesktop((s) => s.selectedNodeId)
  const canLoadMore = useDesktop((s) => s.canLoadMore)
  const loadMoreEnded = useDesktop((s) => s.loadMoreEnded)
  const loadingMore = useDesktop((s) => s.loadingMore)
  const loadMore = useDesktop((s) => s.loadMore)
  const nodeId = selectedNodeId ?? ""
  const visible = !!nodeId && !isSmartFeed(nodeId) && !isTabNode(nodeId) && !!canLoadMore[nodeId]
  const ended = !!loadMoreEnded[nodeId]
  const ref = useRef<HTMLDivElement>(null)
  const loadingRef = useRef(loadingMore)
  loadingRef.current = loadingMore

  // 触底自动加载:Footer 进入视口即翻页(提前 200px,滚动近底预载,不中断)。
  // IO 只挂一次(依赖 visible/ended/loadMore);loading 用 ref 防重入,避免 IO 重建。
  useEffect(() => {
    const el = ref.current
    if (!el || !visible || ended) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loadingRef.current) loadMore()
      },
      { rootMargin: "200px 0px" },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [visible, ended, loadMore])

  return (
    <div ref={ref} className="flex justify-center py-4">
      {visible ? (
        loadingMore ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : ended ? (
          <span className="text-xs text-muted-foreground">已加载全部</span>
        ) : (
          <button
            onClick={loadMore}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            加载更多
          </button>
        )
      ) : null}
    </div>
  )
}

/** 模块级稳定 components 对象(Virtuoso 要求 stable identity)。 */
const gridComponents: GridComponents = {
  List: GridList,
  Item: GridItem,
  Footer: LoadMoreFooter,
}

export function MediaList({
  className,
  itemsOverride,
}: {
  className?: string
  /** 外部传入 items(热搜三栏右栏 = 该词微博流);缺省从 store 读当前视图。 */
  itemsOverride?: MediaItem[]
}) {
  const {
    items: storeItems,
    subscriptions,
    selectedNodeId,
    loading,
    refresh,
    markRead,
    toggleStar,
    resolvePlay,
    resolveLivePlay,
    refreshErrors,
    hotWord,
  } = useDesktop()
  const items = itemsOverride ?? storeItems

  // 刷新按钮只对真实订阅显示:tab 视图节点 / smart feed 无「该订阅」可刷。
  const selectedIsSub = !!selectedNodeId && !isSmartFeed(selectedNodeId) && !isTabNode(selectedNodeId)
  // 顶栏:视图真实身份(热搜词流时 = 「热搜:{词}」)+ 当前订阅刷新是否出错(活性点信号)。
  const viewTitle = viewTitleFor(selectedNodeId, subscriptions, hotWord)
  const hasRefreshError = !!refreshErrors[selectedNodeId ?? ""]
  // 空态指引:按场景给方向(错误→说明;订阅源→可刷新;tab/smart feed 本为空→引导)。
  const emptyHint = hasRefreshError
    ? `刷新失败：${refreshErrors[selectedNodeId ?? ""]}`
    : selectedIsSub
      ? "这个订阅还没有内容，点刷新获取最新"
      : "这里还没有内容，换个视图看看"

  // 模态大播放器:展开的视频/直播条目。按 item 快照(展开后列表可能刷新,用当时的
  // resolve 绑定不失效——resolvePlay/resolveLivePlay 是 store 稳定函数)。
  const [expandedItem, setExpandedItem] = useState<MediaItem | null>(null)

  // 视图 kind 判断:
  //   - 单一 social 视图(内容全是 social,含聚合视图如 tab:social)→ 专属卡片 +
  //     MasonryGrid 瀑布流——social 图为主、高度不一,瀑布流最自然;
  //   - 其余(article/video/audio/live 单一或混合)→ UnifiedCard + VirtuosoGrid 网格。
  const kinds = new Set(items.map((it) => it.kind))
  const isSingleKind = items.length > 0 && kinds.size === 1
  const isSocialView = isSingleKind && kinds.has("social")

  // 响应式列数 state + 模块级接线。RO 回调在模块作用域,setColCount 指向最新 setter。
  const [colCount, setColCountState] = useState(1)
  const setColCountRef = useRef(setColCountState)
  setColCountRef.current = setColCountState
  setColCount = (n) => setColCountRef.current(n)
  // 同步列数到模块级 ref:GridList 渲染时读它(改 gridTemplateColumns → 网格重排)。
  gridColCountRef = colCount

  // 打开模态大播放器:同步手势内解锁 autoplay(点击「大屏/播放」按钮的 transient
  // user activation 窗口内),ExpandedPlayer 挂载后 autoResolve 才能带声起播。
  // ⚠️ 不能在 ExpandedPlayer 的 effect 里 unlock——effect 在 commit 后异步执行,
  // 手势已过期,AudioContext.resume() 被拒 → 解锁失败 → 静音起播。
  const openExpanded = (item: MediaItem) => {
    unlockAudioPlayback()
    setExpandedItem(item)
  }

  // 模块级稳定回调:onOpen 只依赖参数 url,可提前绑定。
  // 卡片分发:social 单一视图 → SocialRenderer(图为主、瀑布流专属卡);
  // 其余(article/video/audio/live 单一或混合)→ UnifiedCard(16:9 中卡,等尺寸)。
  const renderItem = (item: (typeof items)[number]) =>
    isSocialView ? (
      <SocialRenderer key={item.id} item={item as SocialItem} onOpen={openUrl} />
    ) : (
      <UnifiedCard
        key={item.id}
        item={item}
        onOpen={openUrl}
        onToggleRead={markRead}
        onToggleStar={toggleStar}
        onResolvePlay={(itemId) => resolvePlay(item.subscriptionId, itemId)}
        onResolveLivePlay={(roomId) => resolveLivePlay(item.subscriptionId, roomId)}
        onPlayBig={() => openExpanded(item)}
      />
    )

  return (
    // 外层只做布局不滚动(overflow-hidden)——VirtuosoGrid 的 List 自带滚动容器,
    // 若外层也 overflow-y-auto 会出现双滚动条。列表容器 flex-1 min-h-0 撑满剩余高度。
    // ⚠️ 不加 p-2:顶栏需与两侧栏(ArticleList/ArticleDetail)贴边对齐;
    // 列表区水平边距由 GridList/MasonryGrid 自带(paddingLeft/Right 1rem / px-4)。
    <main className={cn("flex h-full min-w-0 min-h-0 flex-1 flex-col overflow-hidden", className)}>
      {/* 顶栏:当前视图身份 + 活性点 + 计数 + 刷新。容器与两侧栏统一
          (h-12 + 两端对齐 + 底分隔线);内部信息有层次——
          标题是视图真名,活性点编码 feed 健康度(健康隐藏/刷新脉冲蓝/错误红)。 */}
      <div className="h-12 flex items-center justify-between gap-4 px-4 border-b border-border shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="font-medium text-sm truncate">{viewTitle}</span>
          <span
            className={cn(
              "size-2 shrink-0 rounded-full transition-colors",
              loading ? "bg-blue-500 animate-pulse" : hasRefreshError ? "bg-destructive" : "bg-transparent",
            )}
            title={loading ? "刷新中…" : hasRefreshError ? "有刷新错误" : undefined}
          />
          <span className="text-xs text-muted-foreground tabular-nums shrink-0">{items.length} 条</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {hasRefreshError && (
            <span className="max-w-44 truncate text-xs text-destructive">{refreshErrors[selectedNodeId!]}</span>
          )}
          {selectedIsSub && (
            <button
              onClick={() => refresh(selectedNodeId!)}
              disabled={loading}
              title="刷新当前订阅"
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              刷新
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 py-4 flex-1">
        {items.length === 0 && !loading ? (
          /* 空态:「无信号」环 = 顶栏活性点的放大静止版(同一语言的两个状态)。
             按场景给方向(错误→说明;订阅源→刷新;tab/smart feed 本为空→引导)。 */
          <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
            <div className="relative flex h-12 w-12 items-center justify-center" aria-hidden>
              <span className="absolute inset-0 rounded-full border-2 border-border" />
              <span className="size-2 rounded-full bg-border" />
            </div>
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-foreground">还没有内容</p>
              <p className="text-xs text-muted-foreground">{emptyHint}</p>
            </div>
            {selectedIsSub && (
              <button
                onClick={() => refresh(selectedNodeId!)}
                disabled={loading}
                title="刷新当前订阅"
                className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                刷新
              </button>
            )}
          </div>
        ) : isSocialView ? (
          /* social → 瀑布流(CSS columns + 无限加载)。图为主、高度不一,瀑布流最自然。
             VirtuosoGrid 假设等尺寸 item 承载不了变高瀑布流,故独立实现。 */
          <MasonryGrid key={selectedNodeId ?? "all"} items={items} renderItem={renderItem} />
        ) : (
          /* 其余 kind → VirtuosoGrid 虚拟化网格(全部 UnifiedCard,等尺寸)。
             key 绑 selectedNodeId:切节点时容器卸载重建,滚动位置归零
             (否则停留在旧视图的 scrollTop,新视图内容少时显示空白)。 */
          <VirtuosoGrid
            key={selectedNodeId ?? "all"}
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
