/**
 * CommandPalette —— ⌘/Ctrl+K 命令面板。搜索范围:内容类型 / 智能订阅 / 页面 /
 * 订阅源 / 条目标题;输入为空时列出命令。
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { useDesktop } from "../../store/index.ts"
import { queryView } from "../../store/selectors.ts"
import { PAGES, SMART, TABS } from "../../store/nodes.ts"
import { Icon } from "../../components/Icon.tsx"
import { useViewNavigate } from "../../router.tsx"
import { usePrefs } from "../../store/prefs.ts"
import { usePlayerNav } from "../player/usePlayerNav.ts"
import { isImeComposing } from "../../lib/ime.ts"
import { overlayBlock } from "../../lib/uiOverlay.ts"

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
      // 复合键：聚合视图里同一 id 会跨订阅出现，裸 id 会让 cmdk/React key 撞车。
      id: `item:${it.subscriptionId}:${it.id}`,
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
          // ⚠️ s.view.list 是**分页窗口**(≤ PAGE_SIZE 60) —— 直接用它「全部标读」会漏掉
          // 窗口外的条目,与文案不符。用 queryView 放大 page 取全量(与 ArticlePane 同款),
          // 并只对真正未读的计数。
          const n = s.selectedNodeId ?? "tab:all"
          const full = queryView({ ...s, page: { ...s.page, [n]: Number.MAX_SAFE_INTEGER } }, s.selectedNodeId, Date.now()).list
          // 传**条目**(非 id):reading 键要带 subscriptionId(见 core `readingKey`)。
          const unread = full.filter((i) => i.isUnread)
          s.markAllRead(unread)
          s.toast("ok", "已全部标为已读", `${unread.length} 条`)
        },
      },
    ],
    [refreshAll, go],
  )

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return commands
    // ⚠️ 搜索时必须**同时**搜命令 —— 曾只搜 entries(内容类型/订阅/条目),命令
    // (刷新全部/打开设置/清空队列…)只在空输入时列出,打「刷新」一个字都搜不到。
    return [...entries, ...commands]
      .filter((e) => e.title.toLowerCase().includes(needle) || (e.sub ?? "").toLowerCase().includes(needle))
      .slice(0, 40)
  }, [q, entries, commands])

  useEffect(() => setActive(0), [q])

  // 上下键漫游 + Enter 执行。
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      // ⚠️ 输入法组合态守卫:中文输入法候选未上屏时的回车(isComposing / keyCode 229)
      // 是「选词」不是「执行」,不守卫会误触发选中命令(如刷新全部/打开设置)。
      if (isImeComposing(e)) return
      if (e.key === "Escape") {
        e.preventDefault() // 让播放页等的 Esc 守卫(defaultPrevented)不再误触发
        return setOpen(false)
      }
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
      <div
        className="palette"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="命令面板"
        {...overlayBlock("command-palette", "palette:root")}
      >
        <div className="palette-input" {...overlayBlock("palette-input", "palette:input")}>
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
        <div className="palette-list" ref={listRef} {...overlayBlock("palette-list", "palette:list")}>
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

