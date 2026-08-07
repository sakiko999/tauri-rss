/**
 * FeedTree — 递归渲染订阅/分组树(smart feeds 是扁平叶子,复用同一组件)。
 *
 * 纯展示组件,不碰 store。树节点由父组件(Sidebar)构建:
 *   { id, name, icon(可选 lucide), children?, isLeaf, error? }
 * 缩进 paddingLeft = 8 + level*16(参考 tmp/rss-reader 的 FeedItemComponent)。
 */
import { ChevronDown, ChevronRight } from "lucide-react"
import { cn } from "../lib/cn.ts"

export interface FeedTreeNode {
  id: string
  name: string
  /** 前置图标(ReactNode,如 <Rss/>)。可选。 */
  icon?: React.ReactNode
  children?: FeedTreeNode[]
  /** 有 children 时可展开。 */
  isExpanded?: boolean
  /** 错误徽章文案(如订阅刷新失败)。 */
  error?: string
}

export function FeedTree({
  nodes,
  selectedId,
  level = 0,
  onSelect,
  onToggle,
}: {
  nodes: FeedTreeNode[]
  selectedId: string | null
  level?: number
  onSelect: (id: string) => void
  onToggle?: (id: string) => void
}) {
  return (
    <div>
      {nodes.map((node) => {
        const hasChildren = !!node.children && node.children.length > 0
        const isExpanded = node.isExpanded ?? false
        const active = selectedId === node.id
        return (
          <div key={node.id}>
            <div
              className={cn(
                "flex items-center gap-2 px-2 py-1 rounded-md cursor-pointer text-sm",
                "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                active && "bg-sidebar-accent text-sidebar-accent-foreground",
              )}
              style={{ paddingLeft: `${8 + level * 16}px` }}
              onClick={() => {
                // 分组节点(hasChildren)只展开/收起,不 select——分组 id 不是订阅 id,
                // select 会查 `subscriptionId=groupId` 得到空视图。
                if (hasChildren && onToggle) {
                  onToggle(node.id)
                } else {
                  onSelect(node.id)
                }
              }}
            >
              {hasChildren ? (
                <button
                  className="p-0.5 -ml-1 shrink-0 text-sidebar-foreground/60"
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggle?.(node.id)
                  }}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                </button>
              ) : (
                <span className="w-4 shrink-0" />
              )}

              {node.icon && <span className="shrink-0">{node.icon}</span>}

              <span className="flex-1 truncate">{node.name}</span>

              {node.error && (
                <span
                  title={node.error}
                  className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-destructive text-xs text-white"
                >
                  !
                </span>
              )}
            </div>

            {hasChildren && isExpanded && (
              <div>
                <FeedTree
                  nodes={node.children!}
                  selectedId={selectedId}
                  level={level + 1}
                  onSelect={onSelect}
                  onToggle={onToggle}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
