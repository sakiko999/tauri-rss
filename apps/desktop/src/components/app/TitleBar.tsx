/**
 * TitleBar —— 顶栏。三列 grid:品牌+路径 | 搜索框 + 更新状态 | 快捷动作。
 *
 * 中列表头的搜索框是**全局条目搜索**(store.query),作用于当前视图;
 * 播放页/设置页等整页视图下搜索框仍可用(切回库视图生效)。
 */
import { useEffect, useRef } from "react"
import { useDesktop, useNodeMeta } from "../../store/index.ts"
import { usePrefs } from "../../store/prefs.ts"
import { viewTitleFor } from "../../store/nodes.ts"
import { Icon } from "../Icon.tsx"
import { useViewNavigate } from "../../router.tsx"
import { overlayBlock } from "../../lib/uiOverlay.ts"

export function TitleBar() {
  const nodeId = useDesktop((s) => s.selectedNodeId)
  const hotWord = useDesktop((s) => s.hotWord)
  const query = useDesktop((s) => s.query)
  const setQuery = useDesktop((s) => s.setQuery)
  const refreshAll = useDesktop((s) => s.refreshAll)
  const loading = useDesktop((s) => s.loading)
  const refreshErrors = useDesktop((s) => s.refreshErrors)
  const offline = useDesktop((s) => s.offline)
  const setOffline = useDesktop((s) => s.setOffline)
  const setPaletteOpen = useDesktop((s) => s.setPaletteOpen)
  const meta = useNodeMeta(nodeId)
  const railCollapsed = usePrefs((s) => s.railCollapsed)
  const setPrefs = usePrefs((s) => s.set)
  const theme = usePrefs((s) => s.theme)
  const go = useViewNavigate()
  const inputRef = useRef<HTMLInputElement>(null)

  // ⌘F → 聚焦搜索框(与命令面板的 ⌘K 区分)。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const errCount = Object.keys(refreshErrors).length
  const chipState = offline ? "error" : loading ? "busy" : errCount ? "stale" : "ok"
  const chipText = offline ? "离线" : loading ? "更新中" : errCount ? `${errCount} 条失败` : "已同步"

  return (
    <header className="titlebar" {...overlayBlock("titlebar", "app:titlebar")}>
      <div className="titlebar-brand" {...overlayBlock("titlebar-brand", "app:titlebar:brand")}>
        <span className="titlebar-mark">
          <Icon name="rss" size={14} />
        </span>
        <span className="titlebar-name">订阅工作台</span>
        <Icon name="chevronRight" size={13} className="t-dim" />
        <span className="titlebar-path">{viewTitleFor(meta, hotWord)}</span>
      </div>

      <div className="titlebar-center" {...overlayBlock("titlebar-center", "app:titlebar:center")}>
        <label className="titlebar-search">
          <Icon name="search" size={14} />
          <input
            ref={inputRef}
            type="search"
            value={query}
            placeholder="搜索当前列表…"
            aria-label="搜索内容"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button className="update-chip" data-state={chipState} onClick={() => void refreshAll(true)}>
          <Icon name={offline ? "offline" : "refresh"} size={13} />
          <span className="num">{chipText}</span>
        </button>
      </div>

      <div className="titlebar-side" {...overlayBlock("titlebar-side", "app:titlebar:side")}>
        <button
          className="icon-btn"
          title="命令面板 (Ctrl+K)"
          aria-label="命令面板"
          onClick={() => setPaletteOpen(true)}
        >
          <Icon name="command" />
        </button>
        <button
          className="icon-btn"
          aria-pressed={offline}
          title={offline ? "切回在线" : "切到离线"}
          aria-label="离线模式"
          onClick={() => setOffline(!offline)}
        >
          <Icon name="offline" />
        </button>
        <button
          className="icon-btn"
          aria-pressed={railCollapsed}
          title="折叠侧栏 (Ctrl+\)"
          aria-label="折叠侧栏"
          onClick={() => setPrefs({ railCollapsed: !railCollapsed })}
        >
          <Icon name="panelLeft" />
        </button>
        <button
          className="icon-btn"
          title="切换主题"
          aria-label="切换主题"
          onClick={() => setPrefs({ theme: theme === "dark" ? "light" : "dark" })}
        >
          <Icon name={theme === "dark" ? "sun" : "moon"} />
        </button>
        <button
          className="icon-btn"
          title="设置"
          aria-label="设置"
          onClick={() => go("page:settings")}
        >
          <Icon name="settings" />
        </button>
      </div>
    </header>
  )
}
