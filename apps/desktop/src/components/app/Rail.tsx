/**
 * Rail —— 侧边导航**外壳**（合流改版 §3.2）。
 *
 * 自上而下：品牌区 / 主导航 / 内容类型 / 智能订阅 / 模式 / 订阅分组树 / 页脚。
 * 具体内容分在两侧:
 *   - 导航行与分节 = 功能件 `<NavRow>` / `<RailSection>`(components/NavRow.tsx,纯 props);
 *   - 订阅分组树 = 业务件 `<RailGroupTree>`(同目录,自带 Accordion + 方向键导航)。
 * 外壳只做:读 store 取计数、把 store 动作接到功能件上、拼布局。
 *
 * ⚠️ 原 rail-head 的三个动作已迁走（§3.2）：添加订阅 → 「订阅」区块头 +；
 * 扫码登录 → 页脚「账号与凭证」页；刷新全部 → 页脚「同步订阅」。
 * 顶栏 update-chip 同步移除，状态只留这一处，避免两个同义按钮各自显示不同新鲜度。
 */
import { useMemo, useState } from "react"
import { useDesktop } from "../../store/index.ts"
import { usePrefs } from "../../store/prefs.ts"
import { HOME_NODE, MAIN_NAV, PAGES, SHORT_MODES, SMART, TABS, navIdOf } from "../../store/nodes.ts"
import { kindCounts } from "../../store/selectors.ts"
import { fmtAgo, isLiveNow } from "../../lib/media.ts"
import { Icon } from "../Icon.tsx"
import { NavRow, RailSection } from "../NavRow.tsx"
import { usePlayParams, useSettingsNavigate, useViewNavigate } from "../../router.tsx"
import { AddSubscriptionDialog } from "../../views/manage/AddSubscriptionDialog.tsx"
import { RailGroupTree } from "./RailGroupTree.tsx"
import { overlayBlock } from "../../lib/uiOverlay.ts"

/**
 * 内容类型段（§3.2 只留三项）：全部 / 音频 / 直播。
 * ⚠️ 从 TABS 里筛，不另写一份字面量 —— TABS 是全量 kind 的唯一权威，
 * 以后新增 kind 时这里不会悄悄漏掉/多出一项。
 */
const CONTENT_TABS = TABS.filter((t) => t.id === "all" || t.id === "audio" || t.id === "live")

export function Rail() {
  const nodeId = useDesktop((s) => s.selectedNodeId)
  const subscriptions = useDesktop((s) => s.subscriptions)
  const groups = useDesktop((s) => s.groups)
  const allItems = useDesktop((s) => s.allItems)
  const refreshErrors = useDesktop((s) => s.refreshErrors)
  const busy = useDesktop((s) => s.busy)
  const loading = useDesktop((s) => s.loading)
  const dl = useDesktop((s) => s.dl)
  const openGroups = useDesktop((s) => s.openGroups)
  const toggleGroup = useDesktop((s) => s.toggleGroup)
  const refreshAll = useDesktop((s) => s.refreshAll)
  const go = useViewNavigate()
  const goSettings = useSettingsNavigate()
  const collapsed = usePrefs((s) => s.railCollapsed)
  const [addOpen, setAddOpen] = useState(false)

  const counts = useMemo(
    () =>
      kindCounts({
        allItems,
        subscriptions,
        filter: {},
        sort: {},
        page: {},
        query: "",
        selectedNodeId: null,
        refreshErrors,
      }),
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

  // 「影音」的小圆点：此刻确有在播房间才亮（unknown 算在播、offline 不算，判据同 lib/media）。
  const liveNow = useMemo(() => allItems.some(isLiveNow), [allItems])

  // 主导航高亮必须走 navIdOf（按 channelKind 派生），不能 `nodeId === id`：
  // 单条订阅 / 分组 / 播放页的返回节点都不是 tab:*，却应该归到对应入口下。
  // ⚠️ 播放页不改 selectedNodeId（位置由 ?from= 承载），高亮要按返回节点算，
  // 否则从首页点开视频后侧栏仍亮在「首页」——那是「高亮错」而非「不高亮」。
  const play = usePlayParams()
  const nav = navIdOf(play.itemId ? (play.from ?? null) : nodeId, subscriptions, (k) => dl?.channelKind(k))

  // 页脚「最近变更」= max(sub.updatedAt)。⚠️ 不是「上次同步」——updatedAt 是订阅
  // 记录更新时间，不是抓取完成时间（D12），写「上次同步」是在编一个假新鲜度。
  const lastChanged = useMemo(() => subscriptions.reduce((m, s) => Math.max(m, s.updatedAt ?? 0), 0), [subscriptions])

  return (
    <aside className={`rail${collapsed ? " rail-collapsed" : ""}`} {...overlayBlock("rail", "app:rail")}>
      {/* ⚠️「添加订阅」必须放在**不会被折叠清单隐藏**的容器里：它是唯一的手工订阅入口
          （命令面板没有添加命令、设置页只建分组）。之前挂在「订阅」区块头，64px 栏
          （Ctrl+\ 折叠或窗口 ≤1080）下整行 display:none，入口直接消失。 */}
      <div className="rail-brand-row" {...overlayBlock("rail-brand-row", "app:rail:brand")}>
        <button className="rail-brand" onClick={() => go(HOME_NODE)} title="合流 · 回首页" aria-label="合流，回首页">
          <span className="rail-brand-mark" aria-hidden>
            <Icon name="rss" size={15} />
          </span>
          <span className="rail-brand-text">
            <span className="rail-brand-name">合流</span>
            <span className="rail-brand-sub">HELIU</span>
          </span>
        </button>
        <button
          className="icon-btn sm rail-brand-add"
          aria-label="添加订阅"
          title="添加订阅"
          onClick={() => setAddOpen(true)}
        >
          <Icon name="plus" size={14} />
        </button>
      </div>

      <nav className="rail-main" aria-label="主导航" {...overlayBlock("rail-main", "app:rail:main")}>
        {MAIN_NAV.map((m) => (
          <NavRow
            key={m.id}
            icon={m.icon}
            label={m.label}
            dot={m.id === "media" ? liveNow : undefined}
            active={nav === m.id}
            onClick={() => go(m.nodeId)}
          />
        ))}
      </nav>

      <div className="rail-scroll scroll-area" {...overlayBlock("rail-scroll", "app:rail:scroll")}>
        <RailSection title="内容类型">
          {CONTENT_TABS.map((t) => {
            const id = t.id === "all" ? "tab:all" : `tab:${t.id}`
            return (
              <NavRow
                key={id}
                icon={t.icon}
                label={t.label}
                count={counts[t.id] ?? 0}
                active={nodeId === id}
                onClick={() => go(id)}
              />
            )
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
            <span className="rail-section-actions">
              <button
                className="icon-btn sm"
                aria-label="管理分组"
                title="管理分组"
                onClick={() => goSettings("subscriptions")}
              >
                <Icon name="settings" size={13} />
              </button>
            </span>
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

      <div className="rail-foot" {...overlayBlock("rail-foot", "app:rail:foot")}>
        <div className="rail-pages">
          {PAGES.map((p) => (
            <NavRow key={p.id} icon={p.icon} label={p.label} active={nodeId === p.id} onClick={() => go(p.id)} />
          ))}
        </div>
        {/* 刷新全部的唯一入口（顶栏 update-chip 已移除）。loading 时图标转起来，
            按钮本身不禁用 —— 重复点会走 refreshAll 内部的并发守卫。 */}
        <div className="rail-sync">
          <button
            className="nav-row rail-sync-btn"
            onClick={() => void refreshAll(true)}
            title="同步订阅"
            aria-label="同步订阅"
          >
            <Icon name="refresh" className={loading ? "animate-spin" : undefined} />
            <span className="nav-label">同步订阅</span>
          </button>
          {lastChanged ? <span className="rail-sync-meta num">最近变更 {fmtAgo(lastChanged)}</span> : null}
        </div>
      </div>

      <AddSubscriptionDialog open={addOpen} onOpenChange={setAddOpen} />
    </aside>
  )
}
