/**
 * ArticlePane —— 阅读视图的列表栏(--col 宽):表头 + 筛选条 + 虚拟化列表。
 *
 * 用 react-virtuoso(虚拟化),列表项是 ListRow。筛选条提供「仅未读」与排序切换。
 */
import { useMemo } from "react"
import { Virtuoso } from "react-virtuoso"
import type { MediaItem } from "@tauri-playground/core"
import { useDesktop, useNodeMeta } from "../../store/index.ts"
import { viewTitleFor } from "../../store/nodes.ts"
import { healthOf } from "../../store/selectors.ts"
import { ListRow } from "../../components/ListRow.tsx"
import { LoadMoreFooter } from "../../components/LoadMoreFooter.tsx"
import { StateBlock } from "../../components/StateBlock.tsx"
import { Icon } from "../../components/Icon.tsx"
import { Menu, MenuItem, MenuSeparator } from "../../components/Modal.tsx"
import { useViewNavigate } from "../../router.tsx"

export function ArticlePane() {
  const nodeId = useDesktop((s) => s.selectedNodeId)
  const view = useDesktop((s) => s.view)
  const hotWord = useDesktop((s) => s.hotWord)
  const selectedArticleId = useDesktop((s) => s.selectedArticleId)
  const selectArticle = useDesktop((s) => s.selectArticle)
  const markRead = useDesktop((s) => s.markRead)
  const toggleStar = useDesktop((s) => s.toggleStar)
  const markAllRead = useDesktop((s) => s.markAllRead)
  const filter = useDesktop((s) => s.filter)
  const sort = useDesktop((s) => s.sort)
  const setFilter = useDesktop((s) => s.setFilter)
  const setSort = useDesktop((s) => s.setSort)
  const refreshErrors = useDesktop((s) => s.refreshErrors)
  const busy = useDesktop((s) => s.busy)
  const loading = useDesktop((s) => s.loading)
  const query = useDesktop((s) => s.query)
  const meta = useNodeMeta(nodeId)
  const settings = useDesktop((s) => s.settings)
  const go = useViewNavigate()

  // 阅读视图只列文章(kind 混杂时按 kind 过滤)。
  const items = useMemo(() => view.list.filter((i) => i.kind === "article"), [view.list])
  const f = filter[nodeId ?? ""] ?? {}
  const mode = sort[nodeId ?? ""] ?? "new"
  const unreadIds = items.filter((i) => i.isUnread).map((i) => i.id)
  const health = meta.sub ? healthOf(meta.sub, refreshErrors, busy) : "ok"

  const openItem = (it: MediaItem) => {
    selectArticle(it.id)
    // 「打开即标已读」是可关的设置;关掉后只选中不改阅读态(键盘 j/k 同理)。
    if (it.isUnread && (settings?.markReadOnOpen ?? true)) markRead(it)
  }

  return (
    <section className="pane col-pane">
      <header className="pane-head">
        <div className="pane-head-main">
          <h2 className="pane-title">{viewTitleFor(meta, hotWord)}</h2>
          <div className="pane-meta">
            <span className="status-dot" data-state={health} />
            {/* ⚠️ 用 view.total(筛选后总数),不是 items.length(分页窗口 ≤60)——
                否则侧栏说 900、表头说 60。与 MediaMain 口径一致。 */}
            <span className="num">{view.total} 条</span>
            {meta.sub?.refreshIntervalSec ? (
              <span>每 {Math.round(meta.sub.refreshIntervalSec / 60)} 分钟刷新</span>
            ) : null}
            {health === "error" ? <span className="err-text">抓取失败</span> : null}
          </div>
        </div>
        <div className="pane-tools">
          <button
            className="icon-btn sm"
            title="全部标为已读"
            aria-label="全部标为已读"
            disabled={!unreadIds.length}
            onClick={() => markAllRead(unreadIds)}
          >
            <Icon name="check" size={14} />
          </button>
          <Menu
            trigger={
              <button className="icon-btn sm" title="排序与筛选" aria-label="排序与筛选">
                <Icon name="more" size={14} />
              </button>
            }
          >
            <MenuItem icon="clock" checked={mode === "new"} onSelect={() => setSort(nodeId ?? "", "new")}>
              按时间
            </MenuItem>
            <MenuItem icon="speed" checked={mode === "hot"} onSelect={() => setSort(nodeId ?? "", "hot")}>
              按热度
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              icon="eye"
              checked={!!f.unreadOnly}
              onSelect={() => setFilter(nodeId ?? "", { unreadOnly: !f.unreadOnly })}
            >
              仅未读
            </MenuItem>
          </Menu>
        </div>
      </header>

      {f.unreadOnly || meta.sub ? (
        <div className="filterbar">
          <div className="rail-chips">
            <button className="chip chip-sm" aria-pressed={!!f.unreadOnly} onClick={() => setFilter(nodeId ?? "", { unreadOnly: !f.unreadOnly })}>
              <Icon name="eye" size={12} /> 仅未读
            </button>
            <button className="chip chip-sm" aria-pressed={mode === "hot"} onClick={() => setSort(nodeId ?? "", mode === "hot" ? "new" : "hot")}>
              <Icon name="speed" size={12} /> 热度
            </button>
          </div>
        </div>
      ) : null}

      {loading && items.length === 0 && !query ? (
        <StateBlock icon="loader" title="正在加载…" text="首次抓取或刷新进行中。" />
      ) : items.length === 0 ? (
        <EmptyState nodeId={nodeId} hasSub={!!meta.sub} disabled={meta.sub ? !meta.sub.enabled : false} onGo={go} />
      ) : (
        <Virtuoso
          className="scroll-area"
          style={{ flex: 1, minHeight: 0 }}
          data={items}
          computeItemKey={(_, it) => it.id}
          // 渠道分页 + 本地窗口翻页共用一个尾部(见 LoadMoreFooter)。
          components={{ Footer: LoadMoreFooter }}
          itemContent={(_, it) => (
            <ListRow
              item={it}
              active={selectedArticleId === it.id}
              onOpen={openItem}
              onToggleRead={markRead}
              onToggleStar={toggleStar}
            />
          )}
        />
      )}
    </section>
  )
}

function EmptyState({
  nodeId,
  hasSub,
  disabled,
  onGo,
}: {
  nodeId: string | null
  hasSub: boolean
  disabled: boolean
  onGo: (id: string) => void
}) {
  const query = useDesktop((s) => s.query)
  const offline = useDesktop((s) => s.offline)
  if (query) return <StateBlock icon="search" title="没有匹配的内容" text={`当前列表里没有包含「${query}」的条目。只搜索标题、作者与摘要。`} />
  if (offline) return <StateBlock icon="offline" title="离线模式" text="已跳过网络抓取。切回在线后再刷新。" />
  // ⚠️ 智能订阅的「空」优先于 hasSub:点「全部标为已读」后列表清空,说「还没有内容」
  // 是错的,应该告诉用户「全部读完」。
  if (nodeId === "unread") return <StateBlock icon="checkCircle" tone="ok" title="全部已读" text="没有未读条目了。" />
  if (nodeId === "starred") return <StateBlock icon="star" title="还没有星标条目" text="在列表里点星标图标收藏。" />
  if (disabled) return <StateBlock icon="lock" title="订阅已停用" text="在「设置 → 订阅」里重新启用它。" />
  if (hasSub) return <StateBlock icon="inbox" title="这个订阅还没有内容" text="点侧栏的刷新按钮抓一次,或等下一个刷新周期。" />
  return (
    <StateBlock
      icon="rss"
      title="还没有订阅"
      text="从「发现」浏览平台分区,或点侧栏的 + 手动添加一个源。"
      actions={
        <button className="btn btn-primary" onClick={() => onGo("page:discover")}>
          <Icon name="compass" size={14} /> 去发现
        </button>
      }
    />
  )
}

