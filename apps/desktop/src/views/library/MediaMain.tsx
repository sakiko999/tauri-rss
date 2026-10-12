/**
 * MediaMain —— 非文章节点的网格主区。按内容形态分发:
 *   social 独占 → MasonryGrid 瀑布流
 *   含直播     → 「正在直播」横滑轨 + 「其余内容」网格
 *   其余       → 单个网格
 *
 * 网格保留 VirtuosoGrid 虚拟化(比 new_desktop 的 page-cap 全量渲染更适合大库)。
 * 点击卡片 → 播放入口(手势内 unlockAudioPlayback,见 usePlayerNav)。
 */
import { useMemo } from "react"
import { VirtuosoGrid } from "react-virtuoso"
import { itemKey } from "../../lib/media.ts"
import { useDesktop, useNodeMeta } from "../../store/index.ts"
import { viewTitleFor } from "../../store/nodes.ts"
import { healthOf } from "../../store/selectors.ts"
import { MediaCard, SocialCard } from "../../components/cards.tsx"
import { MasonryGrid } from "../../components/MasonryGrid.tsx"
import { LoadMoreFooter } from "../../components/LoadMoreFooter.tsx"
import { StateBlock } from "../../components/StateBlock.tsx"
import { Icon } from "../../components/Icon.tsx"
import { usePlayerNav } from "../player/usePlayerNav.ts"
import { useViewNavigate } from "../../router.tsx"

/**
 * Virtuoso 网格的列宽/间距全部走 CSS —— `listClassName="media-grid"`(grid 列模板)
 * + `itemClassName="media-card-item"`(铺满轨道并把卡片拉到等高)。
 *
 * ⚠️ 两个已踩的坑(改前的「卡片参差 + 虚拟化错位」根因):
 *   1. **别用 components.List/Item 覆盖** —— virtuoso 不给 Item 下发宽高,只给
 *      `className`;而 List 的 inline `style` 带 paddingTop/paddingBottom **虚拟化
 *      偏移**,自己拼 style 很容易把它盖掉 → 滚动定位整体错位。
 *   2. **Item 不能 display:flex 成收缩项** —— 卡片会缩到内容宽而非铺满网格轨道。
 */

export function MediaMain() {
  const nodeId = useDesktop((s) => s.selectedNodeId)
  const view = useDesktop((s) => s.view)
  const hotWord = useDesktop((s) => s.hotWord)
  const query = useDesktop((s) => s.query)
  const offline = useDesktop((s) => s.offline)
  const refreshErrors = useDesktop((s) => s.refreshErrors)
  const busy = useDesktop((s) => s.busy)
  const meta = useNodeMeta(nodeId)
  const actions = usePlayerNav()
  const go = useViewNavigate()

  // 热搜词流优先(三栏右栏语义)。
  const items = hotWord ? hotWord.items : view.list
  const socialOnly = items.length > 0 && items.every((i) => i.kind === "social")
  const liveItems = useMemo(() => items.filter((i) => i.kind === "live"), [items])
  const restItems = useMemo(() => items.filter((i) => i.kind !== "live"), [items])
  const health = meta.sub ? healthOf(meta.sub, refreshErrors, busy) : "ok"
  const hasMix = liveItems.length > 0 && restItems.length > 0

  // 热搜词流加载中(词已选中但内容还没回来)——别闪「空」。
  if (hotWord && hotWord.items.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
        <GridHead title={viewTitleFor(meta, hotWord)} />
        <StateBlock icon="loader" title={`正在取「${hotWord.word}」下的微博…`} text="热搜词流依赖登录 cookie;若失败会给出提示。" />
      </div>
    )
  }

  if (items.length === 0) {
    return <MediaEmpty nodeId={nodeId} query={query} offline={offline} hasSub={!!meta.sub} disabled={meta.sub ? !meta.sub.enabled : false} onGo={go} />
  }

  const pageHead = <GridHead title={viewTitleFor(meta, hotWord)} sub={`${items.length} 条`} health={health} />

  if (socialOnly) {
    return (
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
        {pageHead}
        {/* ⚠️ MasonryGrid 自带内层滚动容器(overflow-y-auto),外面不能再套
            scroll-area,否则出现双重滚动条。 */}
        <div style={{ flex: 1, minHeight: 0 }}>
        <MasonryGrid items={items} renderItem={(it) => <SocialCard item={it} actions={actions} />} />
      </div>
      </div>
    )
  }

  if (hasMix) {
    return (
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
        {pageHead}
        <div className="rail-block">
          <div className="rail-head">
            <span className="grid-title" style={{ fontSize: "var(--fs-h3)" }}>
              正在直播
            </span>
            <span className="grid-sub">{liveItems.length} 个房间</span>
            <span className="spacer" />
            <button className="chip chip-sm" onClick={() => go("tab:live")}>
              <Icon name="radio" size={12} /> 只看直播
            </button>
          </div>
          <div className="rail-track">
            {liveItems.slice(0, 12).map((it) => (
              <MediaCard key={itemKey(it)} item={it} actions={actions} />
            ))}
          </div>
        </div>
        {/* ⚠️ 滚动器由 VirtuosoGrid 自己持有(className 给它),头/尾走 components,
            不要再包一层 overflow 容器。 */}
        <VirtuosoGrid
          className="scroll-area"
          style={{ flex: 1, minHeight: 0 }}
          data={restItems}
          listClassName="media-grid"
          itemClassName="media-card-item"
          components={{
            Header: () => <GridHead title="其余内容" sub={`${restItems.length} 条`} />,
            Footer: LoadMoreFooter,
          }}
          computeItemKey={(_, it) => itemKey(it)}
          itemContent={(_, it) => <MediaCard item={it} actions={actions} />}
        />
      </div>
    )
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <VirtuosoGrid
        className="scroll-area"
        style={{ flex: 1, minHeight: 0 }}
        data={items}
        listClassName="media-grid"
        itemClassName="media-card-item"
        components={{ Header: () => pageHead, Footer: LoadMoreFooter }}
        computeItemKey={(_, it) => itemKey(it)}
        itemContent={(_, it) => <MediaCard item={it} actions={actions} />}
      />
    </div>
  )
}

function GridHead({ title, sub, health }: { title: string; sub?: string; health?: string }) {
  return (
    <div className="grid-head">
      <span className="grid-title">{title}</span>
      {sub ? <span className="grid-sub num">{sub}</span> : null}
      <span className="spacer" />
      {health && health !== "ok" ? <span className="status-dot" data-state={health} title="订阅状态" /> : null}
    </div>
  )
}

function MediaEmpty({
  nodeId,
  query,
  offline,
  hasSub,
  disabled,
  onGo,
}: {
  nodeId: string | null
  query: string
  offline: boolean
  hasSub: boolean
  disabled: boolean
  onGo: (id: string) => void
}) {
  if (query) return <StateBlock icon="search" title="没有匹配的内容" text={`当前列表里没有包含「${query}」的条目。`} />
  if (offline) return <StateBlock icon="offline" title="离线模式" text="已跳过网络抓取。切回在线后再刷新。" />
  if (disabled) return <StateBlock icon="lock" title="订阅已停用" text="在「设置 → 订阅」里重新启用它。" />
  if (hasSub)
    return (
      <StateBlock
        icon="inbox"
        title="这个源还没有内容"
        text="点侧栏的刷新按钮抓一次;若持续为空,可能是该房间未开播或需要登录。"
      />
    )
  if (nodeId === "starred") return <StateBlock icon="star" title="还没有星标条目" text="在列表或卡片上点星标图标收藏。" />
  if (nodeId === "unread") return <StateBlock icon="checkCircle" tone="ok" title="全部已读" text="没有未读条目了。" />
  return (
    <StateBlock
      icon="layers"
      title="这里还没有内容"
      text="从「发现」浏览平台分区,或点侧栏的 + 添加一个源。"
      actions={
        <button className="btn btn-primary" onClick={() => onGo("page:discover")}>
          <Icon name="compass" size={14} /> 去发现
        </button>
      }
    />
  )
}
