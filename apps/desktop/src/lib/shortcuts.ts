/**
 * useGlobalShortcuts —— 应用级键盘快捷键(在 App 挂载一次)。
 *
 *   Ctrl/⌘+K  命令面板(CommandPalette 自己监听)
 *   Ctrl/⌘+\  折叠侧栏
 *   Ctrl/⌘+R  刷新全部(拦截默认的页面重载)
 *   Ctrl/⌘+F  聚焦搜索框(TitleBar 监听)
 *   Ctrl/⌘+,  打开设置
 *   阅读视图  j/k 或 ↑/↓ 上下切换文章
 *
 * 输入框内不拦截(j/k 等)。
 */
import { useEffect } from "react"
import { useDesktop } from "../store/index.ts"
import { usePrefs } from "../store/prefs.ts"
import { useViewNavigate } from "../router.tsx"

export function useGlobalShortcuts(): void {
  const go = useViewNavigate()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const inField =
        !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)

      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === "\\") {
        e.preventDefault()
        usePrefs.getState().set({ railCollapsed: !usePrefs.getState().railCollapsed })
        return
      }
      if (mod && e.key.toLowerCase() === "r") {
        e.preventDefault()
        void useDesktop.getState().refreshAll(true)
        return
      }
      if (mod && e.key === ",") {
        e.preventDefault()
        go("page:settings")
        return
      }
      // 阅读视图 j/k、↑/↓ 切换文章。
      if (!mod && !inField && (e.key === "j" || e.key === "k" || e.key === "ArrowDown" || e.key === "ArrowUp")) {
        const s = useDesktop.getState()
        const list = s.view.list.filter((i) => i.kind === "article")
        if (!list.length) return
        const idx = list.findIndex((i) => i.id === s.selectedArticleId)
        const down = e.key === "j" || e.key === "ArrowDown"
        const next = idx < 0 ? list[0] : list[Math.max(0, Math.min(list.length - 1, idx + (down ? 1 : -1)))]
        if (!next || next.id === s.selectedArticleId) return
        e.preventDefault()
        s.selectArticle(next.id)
        if (next.isUnread && (s.settings?.markReadOnOpen ?? true)) s.markRead(next)
        // 让列表滚动到选中项。
        document.querySelector('[aria-current="true"].list-row')?.scrollIntoView({ block: "nearest" })
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [go])
}
