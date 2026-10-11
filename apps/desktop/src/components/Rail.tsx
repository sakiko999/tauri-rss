/**
 * Rail —— 侧边导航。三段:内容类型 / 智能订阅 / 订阅分组树;底部三个页面入口。
 *
 * 订阅行的尾槽编码**健康状态**(错误 / 停用 / 刷新中 / 未读数),对应
 * new_desktop 的 subRow。分组行点击只展开不选中(与旧三栏一致)。
 */
import { useMemo } from "react"
import type { Subscription } from "@tauri-playground/core"
import { useDesktop } from "../store/index.ts"
import { usePrefs } from "../store/prefs.ts"
import { PAGES, SMART, TABS, KIND_META, DEFAULT_VIEW, isTabNode } from "../store/nodes.ts"
import { healthOf, kindCounts, type Health } from "../store/selectors.ts"
import { Icon } from "./Icon.tsx"
import { useViewNavigate } from "../router.tsx"
import { AddSubscriptionDialog } from "../views/manage/AddSubscriptionDialog.tsx"
import { useState } from "react"

const HEALTH_ICON: Partial<Record<Health, string>> = { error: "alert", stale: "warning" }

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
  const collapsed = usePrefs((s) => s.railCollapsed)
  const [addOpen, setAddOpen] = useState(false)

  const counts = useMemo(() => kindCounts({ allItems, subscriptions, filter: {}, sort: {}, page: {}, query: "", selectedNodeId: null, refreshErrors }), [allItems, subscriptions, refreshErrors])
  const unreadOf = useMemo(() => {
    const m: Record<string, number> = {}
    for (const i of allItems) if (i.isUnread) m[i.subscriptionId] = (m[i.subscriptionId] ?? 0) + 1
    return m
  }, [allItems])
  const unreadTotal = allItems.filter((i) => i.isUnread).length
  const starredTotal = allItems.filter((i) => i.isStarred).length
  const todayTotal = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return allItems.filter((i) => (i.publishedAt ?? 0) >= d.getTime()).length
  }, [allItems])

  const smartCount: Record<string, number> = { today: todayTotal, unread: unreadTotal, starred: starredTotal }
  const grouped = useMemo(() => {
    const byGroup = new Map<string, Subscription[]>()
    for (const s of subscriptions) {
      const key = s.groupId ?? ""
      const arr = byGroup.get(key) ?? []
      arr.push(s)
      byGroup.set(key, arr)
    }
    return byGroup
  }, [subscriptions])

  return (
    <aside className={`rail${collapsed ? " rail-collapsed" : ""}`}>
      <div className="rail-head">
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

      <div className="rail-scroll scroll-area">
        <section className="rail-section">
          <RailTitle>内容类型</RailTitle>
          {TABS.map((t) => {
            const id = t.id === "all" ? "tab:all" : `tab:${t.id}`
            const n = counts[t.id] ?? 0
            return (
              <button
                key={id}
                className="nav-row"
                aria-current={nodeId === id ? "page" : undefined}
                onClick={() => go(id)}
                title={t.label}
              >
                <Icon name={t.icon} />
                <span className="nav-label">{t.label}</span>
                {n > 0 ? <span className="nav-count num">{n}</span> : null}
              </button>
            )
          })}
        </section>

        <section className="rail-section">
          <RailTitle>智能订阅</RailTitle>
          {SMART.map((s) => {
            const n = smartCount[s.id] ?? 0
            const unread = s.id === "unread"
            return (
              <button
                key={s.id}
                className="nav-row"
                aria-current={nodeId === s.id ? "page" : undefined}
                onClick={() => go(s.id)}
                title={s.label}
              >
                <Icon name={s.icon} />
                <span className="nav-label">{s.label}</span>
                {n > 0 ? (
                  <span className="nav-count num" data-unread={unread ? "true" : undefined}>
                    {n}
                  </span>
                ) : null}
              </button>
            )
          })}
        </section>

        <section className="rail-section">
          <RailTitle>订阅</RailTitle>
          {groups.map((g) => {
            const members = grouped.get(g.id) ?? []
            const open = openGroups[g.id] ?? true
            const gid = `group:${g.id}`
            return (
              <div key={g.id}>
                <div className="nav-row group-head">
                  <button
                    className="nav-caret-btn"
                    aria-label={open ? "折叠分组" : "展开分组"}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleGroup(g.id)
                    }}
                  >
                    <Icon name="chevronRight" size={13} className="nav-caret" data-open={String(open)} />
                  </button>
                  <button
                    className="nav-row-inner"
                    aria-current={nodeId === gid ? "page" : undefined}
                    onClick={() => go(gid)}
                    title={g.title}
                  >
                    <Icon name="folder" size={14} />
                    <span className="nav-label">{g.title}</span>
                    <span className="nav-count num">{members.length}</span>
                  </button>
                </div>
                {open ? (
                  <div className="group-children">
                    {members.map((s) => (
                      <SubRow key={s.id} sub={s} active={nodeId === s.id} unread={unreadOf[s.id] ?? 0} health={healthOf(s, refreshErrors, busy)} onOpen={() => go(s.id)} />
                    ))}
                  </div>
                ) : null}
              </div>
            )
          })}
          {(grouped.get("") ?? []).length > 0 ? (
            <div className="group-children" style={{ paddingLeft: 0 }}>
              {(grouped.get("") ?? []).map((s) => (
                <SubRow key={s.id} sub={s} active={nodeId === s.id} unread={unreadOf[s.id] ?? 0} health={healthOf(s, refreshErrors, busy)} onOpen={() => go(s.id)} />
              ))}
            </div>
          ) : null}
          {subscriptions.length === 0 ? (
            <p className="rail-empty">还没有订阅。点上方 + 添加，或到「发现」浏览平台分区。</p>
          ) : null}
        </section>
      </div>

      <div className="rail-foot">
        {PAGES.map((p) => (
          <button
            key={p.id}
            className="nav-row"
            aria-current={nodeId === p.id ? "page" : undefined}
            onClick={() => go(p.id)}
            title={p.label}
          >
            <Icon name={p.icon} />
            <span className="nav-label">{p.label}</span>
          </button>
        ))}
      </div>

      <AddSubscriptionDialog open={addOpen} onOpenChange={setAddOpen} />
    </aside>
  )
}

function RailTitle({ children }: { children: React.ReactNode }) {
  return <div className="rail-section-title">{children}</div>
}

function SubRow({
  sub,
  active,
  unread,
  health,
  onOpen,
}: {
  sub: Subscription
  active: boolean
  unread: number
  health: Health
  onOpen: () => void
}) {
  const dl = useDesktop((s) => s.dl)
  const kind = dl?.channelKind(sub.channelKey)
  const warnIcon = HEALTH_ICON[health]
  return (
    <button
      className="nav-row sub-row"
      data-kind={kind}
      aria-current={active ? "page" : undefined}
      onClick={onOpen}
      title={sub.title}
    >
      <span className="sub-dot" />
      <span className="nav-label">{sub.title}</span>
      {warnIcon ? (
        <span className="nav-warn" title={health === "error" ? "抓取失败" : "数据陈旧"}>
          <Icon name={warnIcon} size={13} />
        </span>
      ) : health === "disabled" ? (
        <span className="nav-count t-dim">停用</span>
      ) : health === "busy" ? (
        <span className="status-dot" data-state="busy" />
      ) : unread > 0 ? (
        <span className="nav-count num" data-unread="true">
          {unread}
        </span>
      ) : null}
    </button>
  )
}

export { isTabNode, KIND_META, DEFAULT_VIEW }
