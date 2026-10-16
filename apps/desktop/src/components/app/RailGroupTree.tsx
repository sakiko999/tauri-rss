/**
 * RailGroupTree —— 侧栏的**订阅分组树**(业务件:读 store、吃 domain 类型)。
 *
 * 从 Rail.tsx 拆出。三块内容:
 *   1. 分组树主体 = Radix Accordion(展开态一等公民:`aria-expanded` / `data-state` /
 *      折叠时 `hidden` + 卸载内容);
 *   2. 一层**方向键导航**(策略在 lib/rail-nav.ts,这里只做 DOM 查找与聚焦);
 *   3. 「未分组」伪分组(不可折叠,只作分区标识)+ 空态提示。
 *
 * ⚠️ 只负责树本身 —— 分节标题在外层用 `<RailSection>` 包(那里要放「管理分组」按钮)。
 */
import { useCallback, useMemo, useRef, useState } from "react"
import * as Accordion from "@radix-ui/react-accordion"
import type { Subscription, SubscriptionGroup } from "@amoeba/core"
import { useDesktop } from "../../store/index.ts"
import { KIND_META } from "../../store/nodes.ts"
import { healthOf, type Health } from "../../store/selectors.ts"
import { Icon } from "../Icon.tsx"
import { Menu, MenuItem, MenuSeparator } from "../Modal.tsx"
import { EditSubscriptionDialog } from "../../views/manage/EditSubscriptionDialog.tsx"
import { navAction, type RowCtx } from "../../lib/rail-nav.ts"

const HEALTH_ICON: Partial<Record<Health, string>> = { error: "alert", stale: "warning" }

/** 「未分组」不是真分组(不可折叠),用哨兵值给它一个稳定的行标识。 */
export const UNGROUPED = "\u0000ungrouped"

export function RailGroupTree({
  nodeId,
  subscriptions,
  groups,
  openGroups,
  toggleGroup,
  refreshErrors,
  busy,
  go,
}: {
  nodeId: string | null
  subscriptions: Subscription[]
  groups: SubscriptionGroup[]
  openGroups: Record<string, boolean>
  toggleGroup: (id: string) => void
  refreshErrors: Record<string, string>
  busy: Record<string, boolean>
  go: (id: string) => void
}) {
  // ⚠️ 未读数必须来自 allItems(store 的派生数据)。在这里订阅,免得调用方为
  // 「未读聚合」多传一个 memo 进来。
  const allItems = useDesktop((s) => s.allItems)
  const unread = useMemo(() => {
    const m: Record<string, number> = {}
    for (const i of allItems) if (i.isUnread) m[i.subscriptionId] = (m[i.subscriptionId] ?? 0) + 1
    return m
  }, [allItems])

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

  // ── Accordion 受控 value ────────────────────────────────────────────
  // ⚠️ 不把 openGroups 改成 string[]:它是 Record<string, boolean> 且「未记录 = 展开」,
  // 数组表达不了这个缺省(["g1"] 区分不出 g2 是缺省展开还是被折叠)。所以只在**变化的
  // 那一个**上翻转现成的 toggleGroup(幂等)—— store 一行不用改。
  const groupIds = useMemo(() => groups.map((g) => g.id), [groups])
  const openIds = useMemo(() => groupIds.filter((id) => openGroups[id] ?? true), [groupIds, openGroups])
  const onGroupsChange = useCallback(
    (next: string[]) => {
      const changed = groupIds.find((id) => next.includes(id) !== (openGroups[id] ?? true))
      if (changed) toggleGroup(changed)
    },
    [groupIds, openGroups, toggleGroup],
  )

  // ── 方向键导航 ──────────────────────────────────────────────────────
  // ⚠️ 不做 roving tabindex:行按钮全部留在 Tab 序里,方向键只是**叠加的增强**。
  // 这一节只有十几行,把按钮移出 Tab 序会让「走到行尾的更多菜单」变难,是退化。
  //
  // ⚠️ 挂点选 Accordion.Root 的 onKeyDown:radix 内部也用 composeEventHandlers(null,
  // handleKeyDown) 挂了同款方向键(只在**它的 Trigger 之间**循环)。composeEventHandlers
  // 先调外部 handler、再检查 defaultPrevented —— 我们消费了键就 preventDefault,radix
  // 那套自然被跳过,不会两套同时动焦点。
  const treeRef = useRef<HTMLDivElement>(null)
  const onTreeKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return
      // 已被更内层消费(如菜单)或已被本处理器处理过一次(冒泡上来) → 不重复。
      if (e.defaultPrevented) return
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-row]")
      if (!el) return
      const root = treeRef.current
      if (!root) return
      const rows = [...root.querySelectorAll<HTMLElement>("[data-row]")]
      const idx = rows.indexOf(el)
      if (idx < 0) return

      const kind = el.dataset.rowKind
      const row: RowCtx =
        kind === "ungrouped"
          ? { kind: "ungrouped", expanded: true, hasChildren: true }
          : kind === "group"
            ? { kind: "group", expanded: el.dataset.rowExpanded === "true", hasChildren: el.dataset.rowHasChildren === "true" }
            : { kind: "member", expanded: false, hasChildren: false }

      const action = navAction(e.key, row)
      // ⚠️ 没消费就**不能** preventDefault —— 否则会吃掉全局快捷键(lib/shortcuts.ts:52
      // 的裸 ↑↓/j/k 切文章靠 defaultPrevented 守卫让内层先处理)。
      if (action.type === "none") return
      e.preventDefault()

      /** 焦点统一落**主按钮**(分组行 = 标题,成员行 = 订阅名):落 caret 会让随后的
          Enter 变成「展开」而不是「跳转」。未分组行没有主按钮,退化成整行(tabIndex=-1)。 */
      const focusRow = (r: HTMLElement | undefined) => {
        if (!r) return
        const btn = r.querySelector<HTMLElement>(".nav-row-inner, .sub-row")
        const target = btn ?? r
        target.focus()
        target.scrollIntoView({ block: "nearest" })
      }
      const flip = () => {
        const gid = el.dataset.rowGroup
        if (gid) toggleGroup(gid)
      }

      switch (action.type) {
        case "move":
          focusRow(rows[idx + action.delta])
          break
        case "first":
          focusRow(rows[0])
          break
        case "last":
          focusRow(rows[rows.length - 1])
          break
        case "expand":
          // ⚠️ 只展开、不动焦点:子行在同一次 setState 之后才挂上,立刻 focus 会查到
          // 旧行序(表现为「→ 跳到了别处」)。再按一次 → 才进子项。
          flip()
          break
        case "into":
          // rows 是文档序,分组行的第一个子行就是它的下一项。
          focusRow(rows[idx + 1])
          break
        case "collapse":
          flip()
          break
        case "out": {
          // 成员行 → 回它所属的那一行。⚠️ 两种结构要走两条路,别只按兄弟找:
          //   · 真分组:成员在 `Accordion.Item > Header + Content(.group-children)` 里,
          //     `.group-children` 的 previousElementSibling 是 **null**(它在 Content 里
          //     是独子)→ 必须向上 `closest('[data-row]')` 才找得到 Item。
          //   · 未分组:成员在 `.group-block > [.group-head-plain][data-row] + .group-children`
          //     里,标题是**兄弟**而非祖先 → 走 previousElementSibling。
          const owner =
            el.parentElement?.closest<HTMLElement>("[data-row]") ??
            (el.closest(".group-children")?.previousElementSibling as HTMLElement | null)
          focusRow(owner ?? undefined)
          break
        }
      }
    },
    [toggleGroup],
  )

  const orphans = grouped.get("") ?? []

  return (
    <>
      <Accordion.Root ref={treeRef} type="multiple" value={openIds} onValueChange={onGroupsChange} onKeyDown={onTreeKeyDown}>
        {groups.map((g) => {
          const members = grouped.get(g.id) ?? []
          // 分组徽标:有未读显未读(聚合成员未读),否则显订阅数(new_desktop library.js:88 同款)。
          const unreadN = members.reduce((n, s) => n + (unread[s.id] ?? 0), 0)
          const open = openGroups[g.id] ?? true
          const gid = `group:${g.id}`
          return (
            <Accordion.Item
              key={g.id}
              value={g.id}
              data-row={gid}
              data-row-kind="group"
              data-row-group={g.id}
              data-row-expanded={String(open)}
              data-row-has-children={String(members.length > 0)}
            >
              {/* ⚠️ Header 默认渲染 <h3>(带标题语义与 margin)→ asChild 退化成我们
                  自己的 div,保住 .group-head 的两段式布局与折叠态规则。 */}
              <Accordion.Header asChild>
                <div className="nav-row group-head" data-active={String(nodeId === gid)}>
                  {/* ⚠️ Trigger 只套 caret 按钮,**绝不**铺到整行或标题:
                      标题也是 <button>(按钮不能嵌套),而「点行只跳转、caret 才展开」
                      靠的就是整行里只有 caret 一个能 toggle 的东西。
                      caret 的旋转由 Trigger 自动下发的 data-state 驱动(styles.css)。 */}
                  <Accordion.Trigger asChild>
                    <button className="nav-caret-btn" aria-label="展开或折叠分组" data-row-btn="caret">
                      <Icon name="chevronRight" size={13} className="nav-caret" />
                    </button>
                  </Accordion.Trigger>
                  <button
                    className="nav-row-inner"
                    aria-current={nodeId === gid ? "page" : undefined}
                    onClick={() => go(gid)}
                    title={g.title}
                  >
                    {/* ⚠️ 图标随展开态切换,这是**折叠栏里唯一**能表达展开/折叠的视觉线索
                        —— 折叠态下 `.nav-caret-btn` 被 display:none(与 new_desktop 的
                        参考实现一致),只剩这个图标能说话。没有它,用户按 → 展开了也看不出
                        任何变化,会误以为「快捷键无效」。 */}
                    <Icon name={open ? "folderOpen" : "folder"} size={14} className="group-icon" />
                    <span className="nav-label">{g.title}</span>
                    <span className="nav-count num" data-unread={unreadN ? "true" : undefined}>
                      {unreadN || members.length}
                    </span>
                  </button>
                </div>
              </Accordion.Header>
              <Accordion.Content>
                {open ? (
                  <div className="group-children" role="group" aria-label={g.title}>
                    {members.length === 0 ? (
                      <p className="group-empty">空分组。在「设置 → 订阅与分组」里把订阅移进来</p>
                    ) : (
                      members.map((s) => (
                        <SubRow
                          key={s.id}
                          sub={s}
                          active={nodeId === s.id}
                          unread={unread[s.id] ?? 0}
                          health={healthOf(s, refreshErrors, busy)}
                          onOpen={() => go(s.id)}
                        />
                      ))
                    )}
                  </div>
                ) : null}
              </Accordion.Content>
            </Accordion.Item>
          )
        })}
      </Accordion.Root>
      {/* ⚠️ 未分组订阅必须有自己的标题:平铺在分组之后且无标题时,用户会以为
          它们属于上面那个分组(层级断裂)。它不是 Accordion.Item(不可折叠),
          只作分区标识 —— 方向键仍能停在它身上往下走。 */}
      {orphans.length > 0 ? (
        <div className="group-block">
          {/* ⚠️ tabIndex={-1}:这个伪分组标题本身不可点(只作分区标识),但方向键
              导航要能把焦点停在它身上、再往下走到成员。`-1` 让它能**被程序化聚焦**
              而不进 Tab 序 —— 它不该是一个 Tab 停留点。 */}
          <div className="group-head-plain" data-row={UNGROUPED} data-row-kind="ungrouped" tabIndex={-1}>
            <Icon name="inbox" size={13} />
            <span className="nav-label">未分组</span>
            <span className="nav-count num">{orphans.length}</span>
          </div>
          <div className="group-children">
            {orphans.map((s) => (
              <SubRow
                key={s.id}
                sub={s}
                active={nodeId === s.id}
                unread={unread[s.id] ?? 0}
                health={healthOf(s, refreshErrors, busy)}
                onOpen={() => go(s.id)}
              />
            ))}
          </div>
        </div>
      ) : null}
      {subscriptions.length === 0 ? (
        <p className="rail-empty">还没有订阅。点上方 + 添加，或到「发现」浏览平台分区。</p>
      ) : null}
    </>
  )
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
  const refresh = useDesktop((s) => s.refresh)
  const removeSubscription = useDesktop((s) => s.removeSubscription)
  const toggleSubEnabled = useDesktop((s) => s.toggleSubEnabled)
  const toast = useDesktop((s) => s.toast)
  const [editing, setEditing] = useState(false)
  const kind = dl?.channelKind(sub.channelKey)
  const warnIcon = HEALTH_ICON[health]

  /** 行尾槽位:告警 > 停用 > 刷新中 > 未读;都空时,悬停/聚焦显示管理菜单。 */
  const slot = warnIcon ? (
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
  ) : null

  return (
    <div className="sub-row-wrap" data-active={String(active)} data-row={`s:${sub.id}`} data-row-kind="member">
      <button
        className="nav-row sub-row"
        data-kind={kind}
        aria-current={active ? "page" : undefined}
        onClick={onOpen}
        title={sub.title}
      >
        <span className="sub-dot" />
        {/* ⚠️ 折叠栏(64px)里行里只剩一个图标,而 `.sub-dot` 在折叠态被 display:none
            → 成员行会变成**一排空白行**、只剩悬停才出来的「更多」按钮(用户实测:
            点行正中就是弹菜单)。所以补一个 kind 图标:宽栏里 display:none(视觉不变),
            折叠态才出现,让每个成员行都有可见图元。 */}
        <Icon name={KIND_META[kind ?? "article"]?.icon ?? "rss"} size={15} className="sub-icon" />
        <span className="nav-label">{sub.title}</span>
        {slot ? <span className="sub-slot">{slot}</span> : null}
      </button>
      {/* 侧栏高频管理入口:之前在侧栏看到想改的订阅只能记住名字再跳设置页。 */}
      <div className="sub-more" onClick={(e) => e.stopPropagation()}>
        <Menu
          trigger={
            <button className="icon-btn sm" aria-label={`${sub.title} 的管理菜单`} title="更多操作">
              <Icon name="more" size={13} />
            </button>
          }
        >
          <MenuItem icon="refresh" onSelect={() => void refresh(sub.id)}>
            立即刷新
          </MenuItem>
          <MenuItem icon="edit" onSelect={() => setEditing(true)}>
            编辑…
          </MenuItem>
          <MenuItem icon={sub.enabled ? "eyeOff" : "eye"} onSelect={() => void toggleSubEnabled(sub.id)}>
            {sub.enabled ? "停用" : "启用"}
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            danger
            icon="trash"
            onSelect={() => {
              if (window.confirm(`退订「${sub.title}」?内容缓存也会一并删除。`)) {
                void removeSubscription(sub.id).then(() => toast("ok", `已退订 ${sub.title}`))
              }
            }}
          >
            退订
          </MenuItem>
        </Menu>
      </div>
      <EditSubscriptionDialog sub={editing ? sub : null} onClose={() => setEditing(false)} />
    </div>
  )
}
