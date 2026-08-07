/**
 * App — 两栏验证界面(Tailwind 4)。
 *
 * 左栏:订阅列表(标题 + channelKey + 刷新错误徽章),点击 select。
 * 右栏:选中订阅的 items,按 kind 分发 MediaItemView(ui 渲染器)。
 * 顶部:刷新全部按钮 + loading 指示。
 */
import { useEffect, useRef, useState } from "react"
import { MediaItemView } from "@tauri-playground/ui"
import { useDesktop } from "./store"

const PAGE = 50

export default function App() {
  const {
    subscriptions,
    selectedId,
    items,
    loading,
    refreshErrors,
    init,
    select,
    refresh,
    refreshAll,
    markRead,
    toggleStar,
    resolvePlay,
    resolveLivePlay,
  } = useDesktop()

  useEffect(() => {
    init()
  }, [init])

  // 懒加载:每次渲染前 PAGE 条,滚到底加载更多(避免一次性渲染上千条)。
  const [visibleCount, setVisibleCount] = useState(PAGE)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    setVisibleCount(PAGE) // 切换订阅时重置
  }, [selectedId])
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
  }, [items.length, selectedId])

  const visibleItems = items.slice(0, visibleCount)
  const selected = subscriptions.find((s) => s.id === selectedId)

  return (
    <div className="flex h-screen font-sans">
      {/* ── 左栏:订阅列表 ── */}
      <aside className="w-64 shrink-0 overflow-y-auto border-r border-zinc-200 p-4">
        <h2 className="mb-3 text-lg font-semibold">订阅</h2>
        <button
          onClick={refreshAll}
          disabled={loading}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-50"
        >
          {loading ? "刷新中…" : "刷新全部"}
        </button>
        <ul className="mt-3 space-y-0.5">
          {subscriptions.map((sub) => {
            const err = refreshErrors[sub.id]
            const active = sub.id === selectedId
            return (
              <li
                key={sub.id}
                onClick={() => select(sub.id)}
                className={[
                  "flex cursor-pointer items-center justify-between rounded-md px-3 py-2",
                  active ? "bg-blue-50 border border-blue-200" : "border border-transparent hover:bg-zinc-50",
                ].join(" ")}
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{sub.title}</div>
                  <div className="truncate text-xs text-zinc-400">{sub.channelKey}</div>
                </div>
                {err && (
                  <span title={err} className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-red-600 text-xs text-white">
                    !
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      </aside>

      {/* ── 右栏:选中订阅的 items ── */}
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mb-4 flex items-center gap-3">
          <h1 className="m-0 text-xl font-semibold">{selected?.title ?? "选择订阅"}</h1>
          {selected && (
            <button
              onClick={() => refresh(selected.id)}
              disabled={loading}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-50"
            >
              刷新
            </button>
          )}
          {refreshErrors[selectedId ?? ""] && (
            <span className="text-sm text-red-600">{refreshErrors[selectedId!]}</span>
          )}
        </div>
        <div>
          {items.length === 0 && !loading && <p className="text-sm text-zinc-400">暂无内容</p>}
          {visibleItems.map((item) => (
            <MediaItemView
              key={item.id}
              item={item}
              onOpen={(url) => window.open(url, "_blank")}
              onToggleRead={markRead}
              onToggleStar={toggleStar}
              onResolvePlay={
                selectedId ? (itemId) => resolvePlay(selectedId, itemId) : undefined
              }
              onResolveLivePlay={
                selectedId ? (roomId) => resolveLivePlay(selectedId, roomId) : undefined
              }
            />
          ))}
          {/* 无限滚动哨兵:滚动接近底部时加载更多 */}
          {visibleItems.length < items.length && (
            <div ref={sentinelRef} className="py-4 text-center text-sm text-zinc-400">
              加载更多…({visibleItems.length}/{items.length})
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
