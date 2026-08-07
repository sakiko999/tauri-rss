/**
 * MediaList — 各 kind 中栏单面板(video/audio/live/social 卡片网格)。
 *
 * 复用 ui 包 MediaItemView(内嵌播放:PlayableMedia 懒解析)。懒加载保留
 * (IntersectionObserver 哨兵,PAGE 切片)。播放解析**按 item.subscriptionId 绑定**
 * —— smart feed 聚合视图下选中节点是 smart feed id,不能用于 resolvePlay 查询。
 */
import { useEffect, useRef, useState } from "react"
import { MediaItemView } from "@tauri-playground/ui"
import { cn } from "../lib/cn.ts"
import { isSmartFeed, useDesktop } from "../store.ts"

const PAGE = 50

export function MediaList({ className }: { className?: string }) {
  const {
    items,
    selectedNodeId,
    activeTab,
    loading,
    refresh,
    markRead,
    toggleStar,
    resolvePlay,
    resolveLivePlay,
    refreshErrors,
  } = useDesktop()

  const [visibleCount, setVisibleCount] = useState(PAGE)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    setVisibleCount(PAGE) // 切换节点/tab 时重置
  }, [selectedNodeId, activeTab])
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((c) => Math.min(items.length, c + PAGE))
        }
      },
      { rootMargin: "400px" },
    )
    io.observe(sentinel)
    return () => io.disconnect()
  }, [items.length, selectedNodeId, activeTab])

  const visibleItems = items.slice(0, visibleCount)
  const selectedIsSub = !!selectedNodeId && !isSmartFeed(selectedNodeId)

  return (
    <main className={cn("flex-1 overflow-y-auto p-6", className)}>
      <div className="mb-4 flex items-center gap-3">
        <span className="text-sm text-muted-foreground">{items.length} 条</span>
        {selectedIsSub && (
          <button
            onClick={() => refresh(selectedNodeId!)}
            disabled={loading}
            className="rounded-md border border-border px-3 py-1 text-sm hover:bg-muted disabled:opacity-50"
          >
            刷新
          </button>
        )}
        {refreshErrors[selectedNodeId ?? ""] && (
          <span className="text-sm text-destructive">{refreshErrors[selectedNodeId!]}</span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {items.length === 0 && !loading && <p className="text-sm text-muted-foreground">暂无内容</p>}
        {visibleItems.map((item) => (
          <MediaItemView
            key={item.id}
            item={item}
            onOpen={(url) => window.open(url, "_blank")}
            onToggleRead={markRead}
            onToggleStar={toggleStar}
            onResolvePlay={(itemId) => resolvePlay(item.subscriptionId, itemId)}
            onResolveLivePlay={(roomId) => resolveLivePlay(item.subscriptionId, roomId)}
          />
        ))}
      </div>

      {visibleItems.length < items.length && (
        <div ref={sentinelRef} className="py-4 text-center text-sm text-muted-foreground">
          加载更多…({visibleItems.length}/{items.length})
        </div>
      )}
    </main>
  )
}
