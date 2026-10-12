/**
 * CommandPalette —— ⌘/Ctrl+K 命令面板。搜索范围:内容类型 / 智能订阅 / 页面 /
 * 订阅源 / 条目标题;输入为空时列出命令。
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { useDesktop } from "../../store/index.ts"
import { PAGES, SMART, TABS } from "../../store/nodes.ts"
import { Icon } from "../../components/Icon.tsx"
import { useViewNavigate } from "../../router.tsx"
import { usePrefs } from "../../store/prefs.ts"
import { usePlayerNav } from "../player/usePlayerNav.ts"

interface Entry {
  id: string
  group: string
  title: string
  sub?: string
  icon: string
  run: () => void
}

export function CommandPalette() {
  // 开合在 store(顶栏按钮与 ⌘K 共用);输入/高亮是纯局部状态。
  const open = useDesktop((s) => s.paletteOpen)
  const setOpen = useDesktop((s) => s.setPaletteOpen)
  const [q, setQ] = useState("")
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const subscriptions = useDesktop((s) => s.subscriptions)
  const allItems = useDesktop((s) => s.allItems)
  const refreshAll = useDesktop((s) => s.refreshAll)
  const go = useViewNavigate()
  const actions = usePlayerNav()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen(!useDesktop.getState().paletteOpen)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [setOpen])

  // 每次打开重置输入与高亮(⌘K 与顶栏按钮都会走到这)。
  useEffect(() => {
    if (open) {
      setQ("")
      setActive(0)
    }
  }, [open])

  const entries = useMemo<Entry[]>(() => {
    const nav: Entry[] = [
      ...TABS.map((t) => ({
        id: `tab:${t.id}`,
        group: "内容类型",
        title: t.label,
        icon: t.icon,
        run: () => go(t.id === "all" ? "tab:all" : `tab:${t.id}`),
      })),
      ...SMART.map((s) => ({ id: s.id, group: "智能订阅", title: s.label, icon: s.icon, run: () => go(s.id) })),
      ...PAGES.map((p) => ({ id: p.id, group: "页面", title: p.label, icon: p.icon, run: () => go(p.id) })),
      ...subscriptions.map((s) => ({
        id: s.id,
        group: "订阅",
        title: s.title,
        sub: s.channelKey,
        icon: "rss",
        run: () => go(s.id),
      })),
    ]
    const items: Entry[] = allItems.slice(0, 400).map((it) => ({
      id: `item:${it.id}`,
      group: "条目",
      title: it.title,
      sub: it.author?.name,
      icon: it.kind === "live" ? "radio" : it.kind === "video" ? "play" : it.kind === "audio" ? "music" : it.kind === "social" ? "message" : "rss",
      run: () => actions.onPlay(it),
    }))
    return [...nav, ...items]
  }, [subscriptions, allItems, go, actions])

  const commands: Entry[] = useMemo(
    () => [
      { id: "cmd:refresh", group: "命令", title: "刷新全部订阅", icon: "refresh", run: () => void refreshAll(true) },
      { id: "cmd:settings", group: "命令", title: "打开设置", icon: "settings", run: () => go("page:settings") },
      { id: "cmd:account", group: "命令", title: "打开账号与凭证", icon: "lock", run: () => go("page:account") },
      { id: "cmd:discover", group: "命令", title: "打开发现", icon: "compass", run: () => go("page:discover") },
      { id: "cmd:groups", group: "命令", title: "管理分组", icon: "folder", run: () => go("page:settings") },
      { id: "cmd:offline", group: "命令", title: "切换离线模式", icon: "offline", run: () => useDesktop.getState().setOffline(!useDesktop.getState().offline) },
      {
        id: "cmd:theme",
        group: "命令",
        title: "切换明暗主题",
        icon: "sun",
        run: () => usePrefs.getState().set({ theme: usePrefs.getState().theme === "dark" ? "light" : "dark" }),
      },
      {
        id: "cmd:queue",
        group: "命令",
        title: "清空播放队列",
        icon: "trash",
        run: () => {
          useDesktop.getState().clearQueue()
          useDesktop.getState().toast("ok", "播放队列已清空")
        },
      },
      {
        id: "cmd:markall",
        group: "命令",
        title: "把当前视图全部标为已读",
        icon: "check",
        run: () => {
          const s = useDesktop.getState()
          s.markAllRead(s.view.list.map((i) => i.id))
          s.toast("ok", "已全部标为已读", `${s.view.list.length} 条`)
        },
      },
    ],
    [refreshAll, go],
  )

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return commands
    return entries
      .filter((e) => e.title.toLowerCase().includes(needle) || (e.sub ?? "").toLowerCase().includes(needle))
      .slice(0, 40)
  }, [q, entries, commands])

  useEffect(() => setActive(0), [q])

  // 上下键漫游 + Enter 执行。
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return setOpen(false)
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setActive((i) => Math.min(filtered.length - 1, i + 1))
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setActive((i) => Math.max(0, i - 1))
      } else if (e.key === "Enter") {
        e.preventDefault()
        const hit = filtered[active]
        if (hit) {
          hit.run()
          setOpen(false)
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, filtered, active])

  // 键盘漫游时把激活项滚进视口。
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" })
  }, [active])

  if (!open) return null

  let lastGroup = ""
  return (
    <div className="scrim" data-variant="top" onClick={() => setOpen(false)}>
      <div className="palette" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="命令面板">
        <div className="palette-input">
          <Icon name="search" size={17} />
          <input
            autoFocus
            value={q}
            placeholder="搜索订阅、条目或执行命令…"
            aria-label="命令面板搜索"
            onChange={(e) => setQ(e.target.value)}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-list" ref={listRef}>
          {filtered.length === 0 ? <p className="rail-empty">没有匹配项。</p> : null}
          {filtered.map((e, i) => {
            const header = e.group !== lastGroup ? e.group : null
            lastGroup = e.group
            return (
              <div key={e.id}>
                {header ? <div className="palette-group">{header}</div> : null}
                <button
                  className="palette-item"
                  data-idx={i}
                  data-active={String(i === active)}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => {
                    e.run()
                    setOpen(false)
                  }}
                >
                  <Icon name={e.icon} size={15} />
                  <span className="palette-item-body">
                    <span className="palette-item-title od-truncate">{e.title}</span>
                    {e.sub ? <span className="palette-item-sub od-truncate">{e.sub}</span> : null}
                  </span>
                </button>
              </div>
            )
          })}
        </div>
        <div className="palette-hint">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> 移动
          </span>
          <span>
            <kbd>Enter</kbd> 打开
          </span>
          <span>
            <kbd>Esc</kbd> 关闭
          </span>
          <span className="spacer" />
          <span className="num">{filtered.length} 项</span>
        </div>
      </div>
    </div>
  )
}

