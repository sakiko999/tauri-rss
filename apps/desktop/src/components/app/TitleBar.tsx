/**
 * TitleBar —— 顶栏。三列 grid:当前路径 | 搜索框 | 快捷动作。
 *
 * 品牌区已移到侧栏（§3.2）—— 同一个产品名在顶栏和侧栏各写一遍是两份迟早不一致的副本。
 * 同步状态也移到侧栏页脚（唯一入口），这里不再放 update-chip。
 *
 * 中列表头的搜索框是**当前列表搜索**(store.query),只在有列表的视图出现
 * (reader / media / hot / shortvideo);首页、整页与播放页隐藏 —— 那里没有列表可筛,
 * 留着输入框就是假入口。跨库的全局搜索是 ⌘K 命令面板。
 */
import { useEffect, useRef } from "react"
import { useDesktop, useNodeMeta } from "../../store/index.ts"
import { usePrefs } from "../../store/prefs.ts"
import { viewTitleFor } from "../../store/nodes.ts"
import { Icon } from "../Icon.tsx"
import { usePlayParams, useViewNavigate } from "../../router.tsx"
import { overlayBlock } from "../../lib/uiOverlay.ts"

export function TitleBar() {
  const nodeId = useDesktop((s) => s.selectedNodeId)
  const hotWord = useDesktop((s) => s.hotWord)
  const query = useDesktop((s) => s.query)
  const setQuery = useDesktop((s) => s.setQuery)
  const offline = useDesktop((s) => s.offline)
  const setOffline = useDesktop((s) => s.setOffline)
  const setPaletteOpen = useDesktop((s) => s.setPaletteOpen)
  const meta = useNodeMeta(nodeId)
  const railCollapsed = usePrefs((s) => s.railCollapsed)
  const setPrefs = usePrefs((s) => s.set)
  const theme = usePrefs((s) => s.theme)
  const go = useViewNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const play = usePlayParams()
  /**
   * 内联搜索作用于**当前列表**（store.query → queryView）。首页/片库/设置页/播放页
   * 没有列表可筛，留着输入框就是假入口：打字没有任何反馈（query 还会被下一次
   * select() 清掉）。全局搜索是 ⌘K，不受影响。
   */
  const hasList =
    !play.itemId && (meta.type === "reader" || meta.type === "media" || meta.type === "hot" || meta.type === "shortvideo")

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

  return (
    <header className="titlebar" {...overlayBlock("titlebar", "app:titlebar")}>
      <div className="titlebar-crumb" {...overlayBlock("titlebar-crumb", "app:titlebar:crumb")}>
        <span className="titlebar-path">{viewTitleFor(meta, hotWord)}</span>
      </div>

      <div className="titlebar-center" {...overlayBlock("titlebar-center", "app:titlebar:center")}>
        {hasList ? (
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
        ) : null}
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
