/**
 * ArticlePane —— 阅读视图的列表栏(--col 宽):表头 + 筛选条 + 虚拟化列表。
 *
 * 用 react-virtuoso(虚拟化),列表项是 ListRow。筛选条是「全部 / 未读 / 收藏」
 * 三态 chip(每态带计数),排序留在表头的「排序」菜单里。
 */

import type { MediaItem } from "@amoeba/core"
import { useMemo } from "react"
import { useSearchParams } from "react-router"
import { Virtuoso } from "react-virtuoso"

import { ListRow } from "../../components/app/ListRow.tsx"
import { LoadMoreFooter } from "../../components/app/LoadMoreFooter.tsx"
import { GridSkeleton } from "../../components/BootSkeleton.tsx"
import { Button, IconButton } from "../../components/Button.tsx"
import { Icon } from "../../components/Icon.tsx"
import { Menu, MenuItem } from "../../components/Modal.tsx"
import { StateBlock } from "../../components/StateBlock.tsx"
import { itemKey } from "../../lib/media.ts"
import { overlayBlock } from "../../lib/uiOverlay.ts"
import { useViewNavigate } from "../../router.tsx"
import { useDesktop, useNodeMeta } from "../../store/index.ts"
import { viewTitleFor } from "../../store/nodes.ts"
import { baseFor, healthOf, matchesQuery, PAGE_SIZE, queryView, type ViewFilter } from "../../store/selectors.ts"

export function ArticlePane() {
  const nodeId = useDesktop((s) => s.selectedNodeId)
  const view = useDesktop((s) => s.view)
  const hotWord = useDesktop((s) => s.hotWord)
  const selectedArticleKey = useDesktop((s) => s.selectedArticleKey)
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
  const [searchParams, setSearchParams] = useSearchParams()

  // 阅读视图只列文章(kind 混杂时按 kind 过滤)。
  const items = useMemo(() => view.list.filter((i) => i.kind === "article"), [view.list])
  const f = filter[nodeId ?? ""] ?? {}
  const mode = sort[nodeId ?? ""] ?? "new"
  const allItems = useDesktop((s) => s.allItems)
  const subscriptions = useDesktop((s) => s.subscriptions)

  /**
   * 「未读 / 收藏」chip 的计数。
   *
   * ⚠️ 只数文章:阅读栏只列 kind=article,而 tab:today / unread / resume 这类智能节点
   * 混着视频与动态 —— 直接用全量未读计数会写出「未读 42」但点进去只有 12 条。
   * ⚠️ 计数带上当前搜索词:搜索把列表收窄成 3 条时 chip 还写 42 就是在说谎。
   * ⚠️ 计数**不受 chip 自身影响**:否则切到「收藏」后「未读」的数字跟着变,无法预估。
   */
  const chipCounts = useMemo(() => {
    const s = useDesktop.getState()
    const q = s.query
    const base = baseFor(s, nodeId, Date.now()).filter((i) => i.kind === "article" && (!q || matchesQuery(i, q)))
    let unread = 0
    let starred = 0
    for (const i of base) {
      if (i.isUnread) unread++
      if (i.isStarred) starred++
    }
    return { unread, starred }
  }, [nodeId, allItems, subscriptions, query])

  /**
   * 切换 chip。
   *
   * ⚠️ 先把分页窗口复位再 setFilter:窗口按节点记忆且**只增不减**(growPage / refresh
   * 都只会往上抬)。换筛选后旧窗口没有意义 —— 新集合可能只剩几条,却仍按旧的大窗口
   * 切片、列表还停在原来的滚动位置,用户会落在新列表的中段,看着像「空了」。
   * store 没有 resetPage 动作,这里直接复位;随后 setFilter 里的 refreshView 按新窗口重算。
   */
  const setChip = (patch: ViewFilter) => {
    const n = nodeId ?? "tab:all"
    useDesktop.setState((s) => ({ page: { ...s.page, [n]: PAGE_SIZE } }))
    setFilter(nodeId ?? "", patch)
    // URL 是「视图位置」权威：筛选态写进 ?filter=（刷新/分享/Alt+← 都能还原）。
    // 函数式构造保留 ?word= / ?open= 等其它参数，只改自己这一项。
    const next = new URLSearchParams(searchParams)
    if (patch.starredOnly) next.set("filter", "starred")
    else if (patch.unreadOnly) next.set("filter", "unread")
    else next.delete("filter")
    setSearchParams(next, { replace: true })
  }
  // ⚠️ view.list 只是分页窗口(≤60),「全部标为已读」要覆盖**当前视图全量**。
  // queryView 会按 page 切片,故临时把该节点的 page 放大到全量,再取未读 article
  // —— 否则 900 条只标掉一屏(按钮说「全部」)。仅本文文章栏,故只收 kind=article。
  // ⚠️ 收**条目**而非 id:reading 键要带 subscriptionId(见 core `readingKey`)。
  const unreadItems = useMemo(() => {
    const s = useDesktop.getState()
    const n = nodeId ?? "tab:all"
    const full = queryView({ ...s, page: { ...s.page, [n]: Number.MAX_SAFE_INTEGER } }, nodeId, Date.now()).list
    return full.filter((i) => i.kind === "article" && i.isUnread)
  }, [nodeId, items, filter[nodeId ?? ""], sort[nodeId ?? ""]])
  const health = meta.sub ? healthOf(meta.sub, refreshErrors, busy) : "ok"

  const openItem = (it: MediaItem) => {
    selectArticle(it)
    // 「打开即标已读」是可关的设置;关掉后只选中不改阅读态(键盘 j/k 同理)。
    if (it.isUnread && (settings?.markReadOnOpen ?? true)) markRead(it)
  }

  return (
    <section className="pane col-pane" {...overlayBlock("article-pane", "article:pane")}>
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
          <IconButton
            size="sm"
            title="全部标为已读"
            aria-label="全部标为已读"
            disabled={!unreadItems.length}
            onClick={() => markAllRead(unreadItems)}
          >
            <Icon name="check" size={14} />
          </IconButton>
          <Menu
            trigger={
              <IconButton size="sm" title="排序" aria-label="排序">
                <Icon name="more" size={14} />
              </IconButton>
            }
          >
            <MenuItem icon="clock" checked={mode === "new"} onSelect={() => setSort(nodeId ?? "", "new")}>
              按时间
            </MenuItem>
            <MenuItem icon="speed" checked={mode === "hot"} onSelect={() => setSort(nodeId ?? "", "hot")}>
              按热度
            </MenuItem>
          </Menu>
        </div>
      </header>

      {/* 三态筛选:全部 / 未读 / 收藏。排序只留在表头菜单里 —— 原来筛选条上的「热度」
          chip 与菜单里「按热度」是同一个开关,两处出现必然漂移,已去掉。 */}
      <div className="filterbar reader-filterbar">
        <div className="rail-chips" role="group" aria-label="筛选文章">
          <button
            className="chip chip-sm"
            aria-pressed={!f.unreadOnly && !f.starredOnly}
            onClick={() => setChip({ unreadOnly: false, starredOnly: false })}
          >
            全部
          </button>
          <button
            className="chip chip-sm"
            aria-pressed={!!f.unreadOnly}
            onClick={() => setChip({ unreadOnly: true, starredOnly: false })}
          >
            <Icon name="eye" size={12} /> 未读 <span className="num">{chipCounts.unread}</span>
          </button>
          <button
            className="chip chip-sm"
            aria-pressed={!!f.starredOnly}
            onClick={() => setChip({ starredOnly: true, unreadOnly: false })}
          >
            <Icon name="star" size={12} /> 收藏 <span className="num">{chipCounts.starred}</span>
          </button>
        </div>
      </div>

      {loading && items.length === 0 && !query ? (
        <GridSkeleton mode="list" />
      ) : items.length === 0 ? (
        <EmptyState
          nodeId={nodeId}
          hasSub={!!meta.sub}
          disabled={meta.sub ? !meta.sub.enabled : false}
          unreadOnly={!!f.unreadOnly}
          starredOnly={!!f.starredOnly}
          onGo={go}
        />
      ) : (
        <Virtuoso
          className="scroll-area"
          style={{ flex: 1, minHeight: 0 }}
          data={items}
          // ⚠️ 用 itemKey(subscriptionId:id),不是裸 it.id —— tab:article 是**聚合**视图
          // (跨订阅混排),同一文章 URL 被多个源转载时裸 id 会撞 key(React 复用错行)。
          // 与 MediaMain/MasonryGrid 同款(ShortVideoView 曾漏用,同类修复)。
          computeItemKey={(_, it) => itemKey(it)}
          // 渠道分页 + 本地窗口翻页共用一个尾部(见 LoadMoreFooter)。
          components={{ Footer: LoadMoreFooter }}
          itemContent={(_, it) => (
            <ListRow
              item={it}
              active={selectedArticleKey === itemKey(it)}
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
  unreadOnly,
  starredOnly,
  onGo,
}: {
  nodeId: string | null
  hasSub: boolean
  disabled: boolean
  unreadOnly: boolean
  starredOnly: boolean
  onGo: (id: string) => void
}) {
  const query = useDesktop((s) => s.query)
  const offline = useDesktop((s) => s.offline)
  // ⚠️ 「这个 tab 空了」≠「还没有订阅」：tab:article 是聚合视图、没有订阅身份
  // (hasSub 恒 false)，但有 10 个订阅、只是没有文章时，旧文案会说谎。
  const hasAnySub = useDesktop((s) => s.subscriptions.length > 0)
  const refreshAll = useDesktop((s) => s.refreshAll)
  // ⚠️ 只承诺标题/作者/摘要:生产路径的镜像剥掉了 article.content
  // （docs/audit/refactor-candidates.md 的 A2），写「覆盖正文」时搜索正文永远搜不到。
  if (query)
    return (
      <StateBlock
        icon="search"
        title="没有匹配的内容"
        text={`当前列表里没有包含「${query}」的条目。搜索覆盖标题、作者与摘要；正文不在本地镜像里。`}
      />
    )
  if (offline) return <StateBlock icon="offline" title="离线模式" text="已跳过网络抓取。切回在线后再刷新。" />
  // chip 筛出来的「空」要排在节点自身的空态之前:用户刚点的就是 chip,
  // 这时说「这个订阅还没有内容」是错的(内容在,只是被筛掉了)。
  if (unreadOnly)
    return <StateBlock icon="checkCircle" tone="ok" title="这里没有未读" text="切到「全部」看已读条目,或换一个订阅。" />
  if (starredOnly)
    return (
      <StateBlock icon="star" title="这里没有收藏" text="在列表行上点星标即可收藏;切到「全部」看不带筛选的列表。" />
    )
  // ⚠️ 智能订阅的「空」优先于 hasSub:点「全部标为已读」后列表清空,说「还没有内容」
  // 是错的,应该告诉用户「全部读完」。
  if (nodeId === "unread") return <StateBlock icon="checkCircle" tone="ok" title="全部已读" text="没有未读条目了。" />
  if (nodeId === "starred") return <StateBlock icon="star" title="还没有星标条目" text="在列表里点星标图标收藏。" />
  if (disabled) return <StateBlock icon="lock" title="订阅已停用" text="在「设置 → 订阅」里重新启用它。" />
  if (hasSub)
    return <StateBlock icon="inbox" title="这个订阅还没有内容" text="点侧栏的刷新按钮抓一次,或等下一个刷新周期。" />
  if (hasAnySub) {
    return (
      <StateBlock
        icon="inbox"
        title="这里还没有内容"
        text="当前视图是空的：这个分类下暂时没有条目，或源的内容在其它分类里。刷新一次，或切到「全部」看看。"
        actions={
          <Button variant="primary" onClick={() => void refreshAll(true)}>
            <Icon name="refresh" size={14} /> 刷新
          </Button>
        }
      />
    )
  }
  return (
    <StateBlock
      icon="rss"
      title="还没有订阅"
      text="从「发现」浏览平台分区,或点侧栏的 + 手动添加一个源。"
      actions={
        <Button onClick={() => onGo("page:discover")}>
          <Icon name="compass" size={14} /> 去发现
        </Button>
      }
    />
  )
}
