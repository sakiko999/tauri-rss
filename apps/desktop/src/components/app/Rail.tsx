/**
 * Rail —— 侧边导航**外壳**。
 *
 * 四段:内容类型 / 智能订阅 / 模式 / 订阅;底部三个页面入口。
 * 具体内容分在两侧:
 *   - 导航行与分节 = 功能件 `<NavRow>` / `<RailSection>`(components/NavRow.tsx,纯 props);
 *   - 订阅分组树 = 业务件 `<RailGroupTree>`(同目录,自带 Accordion + 方向键导航)。
 * 外壳只做:读 store 取计数、把 store 动作接到功能件上、拼布局。
 */
import { useMemo, useState } from "react"
import { useDesktop } from "../../store/index.ts"
import { usePrefs } from "../../store/prefs.ts"
import { PAGES, SMART, SHORT_MODES, TABS, KIND_META, DEFAULT_VIEW, isTabNode } from "../../store/nodes.ts"
import { kindCounts } from "../../store/selectors.ts"
import { Icon } from "../Icon.tsx"
import { NavRow, RailSection } from "../NavRow.tsx"
import { useSettingsNavigate, useViewNavigate } from "../../router.tsx"
import { AddSubscriptionDialog } from "../../views/manage/AddSubscriptionDialog.tsx"
import { RailGroupTree } from "./RailGroupTree.tsx"
import { overlayBlock } from "../../lib/uiOverlay.ts"

export function Rail() {
  const nodeId = useDesktop((s) => s.selectedNodeId)
  const subscriptions = useDesktop((s) => s.subscriptions)
  const groups = useDesktop((s) => s.groups)
  const allItems = useDesktop((s) => s.allItems)
  const refreshErrors = useDesktop((s) => s.refreshErrors)
  const busy = useDesktop((s) => s.busy)
  const openGroups = useDesktop((s) => s.openGroups)
  const toggleGroup = useDesktop((s) => s.toggleGroup)
  const refreshAll = useDesktop((s) => s.refreshAll)
  const go = useViewNavigate()
  const goSettings = useSettingsNavigate()
  const collapsed = usePrefs((s) => s.railCollapsed)
  const [addOpen, setAddOpen] = useState(false)

  const counts = useMemo(
    () => kindCounts({ allItems, subscriptions, filter: {}, sort: {}, page: {}, query: "", selectedNodeId: null, refreshErrors }),
    [allItems, subscriptions, refreshErrors],
  )
  const smartCount = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    const midnight = d.getTime()
    let unread = 0
    let starred = 0
    let resume = 0
    let today = 0
    for (const i of allItems) {
      if (i.isUnread) unread++
      if (i.isStarred) starred++
      if ((i.positionSec ?? 0) > 0 || (i.scrollRatio ?? 0) > 0) resume++
      if ((i.publishedAt ?? 0) >= midnight) today++
    }
    return { today, unread, starred, resume }
  }, [allItems])

  return (
    <aside className={`rail${collapsed ? " rail-collapsed" : ""}`} {...overlayBlock("rail", "app:rail")}>
      <div className="rail-head" {...overlayBlock("rail-head", "app:rail:head")}>
        <div className="rail-actions">
          <button className="icon-btn" title="刷新全部 (Ctrl+R)" aria-label="刷新全部" onClick={() => void refreshAll(true)}>
            <Icon name="refresh" />
          </button>
          <button className="icon-btn" title="添加订阅" aria-label="添加订阅" onClick={() => setAddOpen(true)}>
            <Icon name="plus" />
          </button>
          <button className="icon-btn" title="扫码登录" aria-label="扫码登录" onClick={() => go("page:account")}>
            <Icon name="qr" />
          </button>
        </div>
      </div>

      <div className="rail-scroll scroll-area" {...overlayBlock("rail-scroll", "app:rail:scroll")}>
        <RailSection title="内容类型">
          {TABS.map((t) => {
            const id = t.id === "all" ? "tab:all" : `tab:${t.id}`
            return <NavRow key={id} icon={t.icon} label={t.label} count={counts[t.id] ?? 0} active={nodeId === id} onClick={() => go(id)} />
          })}
        </RailSection>

        <RailSection title="智能订阅">
          {SMART.map((s) => (
            <NavRow
              key={s.id}
              icon={s.icon}
              label={s.label}
              count={smartCount[s.id as keyof typeof smartCount] ?? 0}
              unread={s.id === "unread"}
              active={nodeId === s.id}
              onClick={() => go(s.id)}
            />
          ))}
        </RailSection>

        {/* 模式入口:短视频全屏流（第三模式）。仅 video/live 有短片体感；音频不适合。 */}
        <RailSection title="模式">
          {SHORT_MODES.map((m) => {
            const id = `short:${m.kind}`
            return <NavRow key={id} icon={m.icon} label={m.label} active={nodeId === id} onClick={() => go(id)} />
          })}
        </RailSection>

        <RailSection
          title="订阅"
          action={
            <button className="icon-btn sm" aria-label="管理分组" title="管理分组" onClick={() => goSettings("subscriptions")}>
              <Icon name="settings" size={13} />
            </button>
          }
        >
          <RailGroupTree
            nodeId={nodeId}
            subscriptions={subscriptions}
            groups={groups}
            openGroups={openGroups}
            toggleGroup={toggleGroup}
            refreshErrors={refreshErrors}
            busy={busy}
            go={go}
          />
        </RailSection>
      </div>

      <div className="rail-foot">
        {PAGES.map((p) => (
          <NavRow key={p.id} icon={p.icon} label={p.label} active={nodeId === p.id} onClick={() => go(p.id)} />
        ))}
      </div>

      <AddSubscriptionDialog open={addOpen} onOpenChange={setAddOpen} />
    </aside>
  )
}

export { isTabNode, KIND_META, DEFAULT_VIEW }
