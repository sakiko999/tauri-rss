/**
 * MediaList — 中栏媒体面板(video/audio/live/social),统一用 `VirtuosoGrid`。
 *
 * 设计:technical-plan 选定 react-virtuoso「一个库覆盖列表/瀑布流/网格」。
 * VirtuosoGrid 内部是 CSS grid → **行优先填充**(第 0..cols-1 个 item 在第一行,
 * 从左到右),虚拟化只渲染可见区,卡片高度自适应(social 图高不一天然错落成瀑布流)。
 * 相比 CSS columns:列优先 + 追加重平衡会让已渲染 item 移位;VirtuosoGrid 无此问题。
 *
 * 播放解析按 item.subscriptionId 绑定——smart feed 聚合视图下选中节点是
 * smart feed id,不能用于 resolvePlay 查询。
 *
 * 依赖 react-virtuoso(virtualized list/grid 一体化)。
 */
import { forwardRef, useState } from "react"
import { VirtuosoGrid, type GridComponents } from "react-virtuoso"
import type { MediaItem } from "@tauri-playground/core"
import { MediaItemView } from "@tauri-playground/ui"
import { cn } from "../lib/cn.ts"
import { isSmartFeed, useDesktop } from "../store.ts"
import { ExpandedPlayer } from "./ExpandedPlayer.tsx"

/** VirtuosoGrid 需要把「滚动容器 + 网格容器」都显式交给它(它不渲染外层布局)。 */
const gridComponents: GridComponents = {
  List: forwardRef(function GridList({ style, ...props }, ref) {
    return (
      <div
        ref={ref}
        {...props}
        style={{
          ...style,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          gap: "1rem",
        }}
      />
    )
  }),
  Item: forwardRef(function GridItem({ style, ...props }, ref) {
    return <div ref={ref} {...props} style={{ ...style, height: "100%" }} />
  }),
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

  const renderItem = (item: (typeof items)[number]) => (
    <MediaItemView
      key={item.id}
      item={item}
      onOpen={(url) => window.open(url, "_blank")}
      onToggleRead={markRead}
      onToggleStar={toggleStar}
      onResolvePlay={(itemId) => resolvePlay(item.subscriptionId, itemId)}
      onResolveLivePlay={(roomId) => resolveLivePlay(item.subscriptionId, roomId)}
      onPlayBig={() => setExpandedItem(item)}
    />
  )

  return (
    <main className={cn("flex-1 overflow-y-auto p-6", className)}>
      {/* 顶部:当前视图名 + 条数徽章 + 刷新。徽章用实心圆底突出计数。 */}
      <div className="mb-5 flex items-center gap-3">
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

      {items.length === 0 && !loading ? (
        <p className="text-sm text-muted-foreground">暂无内容</p>
      ) : (
        /* VirtuosoGrid:行优先 + 虚拟化(网格/瀑布流统一)。卡片高度自适应,
           social 图片高的自然错落成瀑布,不用手动分列。 */
        <VirtuosoGrid
          totalCount={items.length}
          components={gridComponents}
          itemContent={(index) => renderItem(items[index])}
        />
      )}

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
