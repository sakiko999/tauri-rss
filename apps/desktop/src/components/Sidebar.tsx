/**
 * Sidebar — 三栏左栏(参考 tmp/rss-reader 的 sidebar.tsx,数据来自真实 DataLayer)。
 *
 * 结构:macOS 交通灯 + 工具栏(刷新/添加) + Content Tabs(tab 视图节点,带计数)
 *   + Smart Feeds(today/unread/starred) + 订阅/分组树。
 * 三类节点(tab / smart feed / 订阅)统一由 selectedNodeId 承载,点击即 select。
 * 分组树:groups 顶层组 + 组内 subscriptions(groupId join);无组订阅渲染为顶层叶子。
 */
import { useMemo, useState } from "react"
import type { Subscription, SubscriptionGroup } from "@tauri-playground/core"
import {
  Layers,
  Rss,
  Play,
  Music,
  Radio,
  MessageSquare,
  Sun,
  Circle,
  Star,
  Folder,
  FolderOpen,
  RefreshCw,
  Plus,
  Loader2,
  Moon,
} from "lucide-react"
import { cn } from "../lib/cn.ts"
import { useTheme } from "../theme.ts"
import { useDesktop, SMART_FEED_IDS, isSmartFeed, isTabNode, type ContentTab } from "../store.ts"
import { useViewNavigate } from "../router"
import { FeedTree, type FeedTreeNode } from "./FeedTree.tsx"
import { AddFeedDialog } from "./AddFeedDialog.tsx"

const TABS: { id: ContentTab; label: string; icon: typeof Rss }[] = [
  { id: "all", label: "全部", icon: Layers },
  { id: "article", label: "文章", icon: Rss },
  { id: "video", label: "视频", icon: Play },
  { id: "audio", label: "音频", icon: Music },
  { id: "live", label: "直播", icon: Radio },
  { id: "social", label: "社交", icon: MessageSquare },
]

const SMART_ICONS: Record<string, React.ReactNode> = {
  today: <Sun className="h-4 w-4 text-orange-500" />,
  unread: <Circle className="h-4 w-4 fill-blue-500 text-blue-500" />,
  starred: <Star className="h-4 w-4 fill-yellow-500 text-yellow-500" />,
}

export function Sidebar() {
  const {
    subscriptions,
    groups,
    items,
    allItems,
    selectedNodeId,
    expandedGroups,
    loading,
    refreshErrors,
    toggleGroup,
    refreshAll,
  } = useDesktop()
  // 节点导航走 URL(路由权威):navigate → loader 同步 store.select。
  const go = useViewNavigate()
  const { theme, toggle: toggleTheme } = useTheme()
  const [addOpen, setAddOpen] = useState(false)

  // kind 计数(基于全局 allItems——不随选中订阅变化,侧栏徽章恒定)。
  // allItems 是 store 的全局全部条目;若仍未加载则用当前视图 items 兜底。
  const countSource = allItems.length ? allItems : items
  const counts = useMemo(() => {
    const c: Record<ContentTab, number> = { all: countSource.length, article: 0, video: 0, audio: 0, live: 0, social: 0 }
    for (const it of countSource) if (it.kind in c) c[it.kind as keyof typeof c]++
    return c
  }, [countSource])

  // 订阅树:顶层组(递归) + 无组订阅叶子
  const tree = useMemo<FeedTreeNode[]>(() => {
    const byGroup = new Map<string, Subscription[]>()
    const ungrouped: Subscription[] = []
    for (const s of subscriptions) {
      if (s.groupId) {
        const arr = byGroup.get(s.groupId) ?? []
        arr.push(s)
        byGroup.set(s.groupId, arr)
      } else {
        ungrouped.push(s)
      }
    }
    const buildGroup = (g: SubscriptionGroup, level: number): FeedTreeNode => {
      const children: FeedTreeNode[] = [
        ...(byGroup.get(g.id) ?? []).map((s) => subNode(s)),
        ...groups.filter((c) => c.parentId === g.id).map((c) => buildGroup(c, level + 1)),
      ]
      return {
        id: g.id,
        name: g.title,
        icon: expandedGroups[g.id] ? <FolderOpen className="h-4 w-4 text-blue-500" /> : <Folder className="h-4 w-4 text-blue-500" />,
        children,
        isExpanded: !!expandedGroups[g.id],
      }
    }
    const subNode = (s: Subscription): FeedTreeNode => ({
      id: s.id,
      name: s.title,
      icon: <Rss className="h-4 w-4 text-orange-500" />,
      error: refreshErrors[s.id],
    })
    return [
      ...groups.filter((g) => !g.parentId).map((g) => buildGroup(g, 0)),
      ...ungrouped.map(subNode),
    ]
  }, [subscriptions, groups, expandedGroups, refreshErrors])

  return (
    <>
      <div className="w-64 h-full border-r flex flex-col bg-sidebar border-sidebar-border text-sidebar-foreground">
        {/* ── 顶栏:macOS 交通灯 + 刷新 + 添加 ── */}
        <div className="h-12 flex items-center gap-3 px-4 border-b border-sidebar-border shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <div className="w-3 h-3 rounded-full bg-yellow-500" />
            <div className="w-3 h-3 rounded-full bg-green-500" />
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={refreshAll}
              disabled={loading}
              className="p-1.5 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground rounded disabled:opacity-50"
              title="刷新全部"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </button>
            <button
              onClick={() => setAddOpen(true)}
              className="p-1.5 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground rounded"
              title="添加订阅"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              onClick={toggleTheme}
              className="p-1.5 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground rounded"
              title={theme === "light" ? "切换到暗色" : "切换到亮色"}
            >
              {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* ── Content Tabs(kind 过滤) ── */}
        <div className="flex items-center justify-around px-1 pt-1.5 pb-0 border-b border-sidebar-border shrink-0">
          {TABS.map((tab) => {
            const Icon = tab.icon
            // tab 是内置视图节点:选中态与 smart feed/订阅源统一由 selectedNodeId 承载。
            const active = selectedNodeId === `tab:${tab.id}`
            return (
              <button
                key={tab.id}
                onClick={() => go(`tab:${tab.id}`)}
                className={cn(
                  // grid 固定两行:图标行(h-5)+ 计数行(h-3 固定占位,空内容不塌缩),
                  // 避免 flex 下 span 无内容高度为 0 导致各 tab 图标垂直错位。
                  "relative grid grid-rows-[1.25rem_0.75rem] place-items-center gap-1 pb-2 pt-1.5 rounded-md transition-colors",
                  active ? "text-sidebar-foreground" : "text-sidebar-foreground/50 hover:text-sidebar-foreground/80",
                )}
                title={tab.label}
              >
                <Icon className="h-5 w-5" />
                <span className="text-[10px] leading-none">{counts[tab.id] || ""}</span>
                {/* 激活指示条:当前 kind 的「位置」信号 */}
                <span
                  className={cn(
                    "absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 rounded-full transition-all",
                    active ? "w-6 bg-sidebar-primary" : "w-0",
                  )}
                />
              </button>
            )
          })}
        </div>

        {/* ── Smart Feeds ── */}
        <div className="mt-2 shrink-0">
          <div className="px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-sidebar-foreground/50">
            智能订阅
          </div>
          <FeedTree
            nodes={SMART_FEED_IDS.map((id) => ({
              id,
              name: id === "today" ? "今日" : id === "unread" ? "未读" : "已星标",
              icon: SMART_ICONS[id],
            }))}
            selectedId={isSmartFeed(selectedNodeId) ? selectedNodeId : null}
            onSelect={go}
          />
        </div>

        {/* ── 订阅/分组树 ── */}
        <div className="flex-1 overflow-y-auto py-2">
          <div className="px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-sidebar-foreground/50">
            订阅
          </div>
          <FeedTree
            nodes={tree}
            // 订阅树只高亮真实订阅节点:tab 视图 / smart feed 选中时不传。
            selectedId={!isSmartFeed(selectedNodeId) && !isTabNode(selectedNodeId) ? selectedNodeId : null}
            onSelect={go}
            onToggle={toggleGroup}
          />
        </div>
      </div>

      <AddFeedDialog open={addOpen} onOpenChange={setAddOpen} />
    </>
  )
}
