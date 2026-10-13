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
import { useDesktop } from "../store/index.ts"
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
        // ⚠️ 播放页整页都是播放器:j 未被播放器容器接管(容器只处理 k/空格/方向键/m/f/Home/End/数字),
        // 但也不该在此切换文章(不可见)。**不能靠 selectedNodeId 判**:/play/:itemId 的 loader
        // 故意不改它(见 router.tsx:73),selectedNodeId 恒为**上一个**节点(如 tab:all)→
        // `nodeTypeOf(...)==="player"` 永假(死守卫)。曾因此:播放页按 j 静默把上一个 feed 的
        // 一篇无关文章标为已读并落库(实测 unread 16→15)。改按 URL 判当前是否在播放页。
        if (location.pathname.startsWith("/play/")) return
        const s = useDesktop.getState()
        const list = s.view.list.filter((i) => i.kind === "article")
        if (!list.length) return
        const down = e.key === "j" || e.key === "ArrowDown"
        const found = list.findIndex((i) => i.id === s.selectedArticleId)
        // 目标索引 = 当前索引 + 方向步长。⚠️ 上一条(k/↑)必须是 **-1** —— 旧实现用
        // `+ (found>=0 && down ? 1 : 0)`(up 时加 0)会落回当前项,再被下面的
        // `next.id === selectedArticleId` 挡掉 → 「上一条」键整个失效(只有选中项
        // 已因标已读离场时才偶然可用)。j/k 与 ↑/↓ 对称。
        const step = down ? 1 : -1
        let target: number
        if (found >= 0) {
          // 选中项还在列表里 → 以它为准,直接走一步;更新记忆。
          lastIndexRef.current = found
          target = found + step
        } else {
          // 已离场(刚被标已读):那一格已被后面的条目顶上来了 —— down 取记忆索引即
          // 「下一条」,up 再退一格才是真正的前一条。
          target = down ? lastIndexRef.current : lastIndexRef.current - 1
        }
        const next = list[Math.max(0, Math.min(list.length - 1, target))]
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
