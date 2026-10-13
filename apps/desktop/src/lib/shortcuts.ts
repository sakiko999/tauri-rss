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
import { useEffect, useRef } from "react"
import { nodeTypeOf, useDesktop } from "../store/index.ts"
import { usePrefs } from "../store/prefs.ts"
import { useViewNavigate } from "../router.tsx"

export function useGlobalShortcuts(): void {
  const go = useViewNavigate()
  /**
   * ⚠️ 记住「上次读到第几条」而不是只靠 selectedArticleId 在当前列表里找。
   *
   * 开着「仅未读」时,打开一条即标已读 → 该条当场从 view.list 移除。此时
   * findIndex 返回 -1,旧实现直接取 list[0] —— 用户按 j 会跳回**列表最顶端**,
   * 而不是下一条未读。记住索引并在条目消失时用它继续前进。
   */
  const lastIndexRef = useRef(0)

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
        // ⚠️ 播放器容器对同款按键(空格/k/↑↓/←→/m/f…)已 preventDefault(不 stopPropagation),
        // 事件冒泡到这里时 defaultPrevented=true → 不再劫持。否则在播放页按 k 会在切播放/
        // 暂停的同时把 selectedArticleId 静默挪到相邻文章(返回列表选中项已跳走)。
        if (e.defaultPrevented) return
        // ⚠️ 播放页整页都是播放器:j 未被容器接管,但也不该在此切换文章(不可见)。直接跳过。
        if (nodeTypeOf(useDesktop.getState().selectedNodeId) === "player") return
        const s = useDesktop.getState()
        const list = s.view.list.filter((i) => i.kind === "article")
        if (!list.length) return
        const down = e.key === "j" || e.key === "ArrowDown"
        const found = list.findIndex((i) => i.id === s.selectedArticleId)
        // 选中项还在 → 以它为准并更新记忆;已离场(刚被标已读)→ 用记忆的索引
        // 继续前进(down 时不 +1,因为那一格已经被后面的条目顶上来了)。
        let idx: number
        if (found >= 0) {
          lastIndexRef.current = found
          idx = found
        } else {
          idx = Math.min(lastIndexRef.current, list.length - 1)
          // 上一条已离场时,当前 index 已经是「下一条」;但要往回走(k)就得再退一格。
          if (!down) idx = Math.max(0, idx - 1)
        }
        const next = list[Math.max(0, Math.min(list.length - 1, idx + (found >= 0 && down ? 1 : 0)))]
        if (!next || next.id === s.selectedArticleId) return
        e.preventDefault()
        lastIndexRef.current = list.indexOf(next)
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
