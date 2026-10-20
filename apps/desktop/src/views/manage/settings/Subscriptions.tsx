/** 订阅与分组 tab:OPML 导入导出 + 分组 CRUD + 订阅总表。 */
import { useState } from "react"
import type { Subscription, SubscriptionGroup } from "@amoeba/core"
import { useDesktop } from "../../../store/index.ts"
import { SideCard, StateBlock } from "../../../components/StateBlock.tsx"
import { Icon } from "../../../components/Icon.tsx"
import { Menu, MenuItem, MenuSeparator, Switch } from "../../../components/Modal.tsx"
import { useViewNavigate } from "../../../router.tsx"
import { EditSubscriptionDialog } from "../EditSubscriptionDialog.tsx"
import { exportOpmlFile, pickOpmlFile } from "../../../lib/opml-file.ts"
import type { Store } from "./store-types.ts"
import { isImeComposing } from "../../../lib/ime.ts"

export function Subscriptions() {
  const subscriptions = useDesktop((s) => s.subscriptions)
  const groups = useDesktop((s) => s.groups)
  const toggleSubEnabled = useDesktop((s) => s.toggleSubEnabled)
  const removeSubscription = useDesktop((s) => s.removeSubscription)
  const addGroup = useDesktop((s) => s.addGroup)
  const renameGroup = useDesktop((s) => s.renameGroup)
  const removeGroup = useDesktop((s) => s.removeGroup)
  const autoGroupByKind = useDesktop((s) => s.autoGroupByKind)
  const settings = useDesktop((s) => s.settings)
  const setSetting = useDesktop((s) => s.setSetting)
  const doExportOpml = useDesktop((s) => s.exportOpml)
  const doImportOpml = useDesktop((s) => s.importOpml)
  const toast = useDesktop((s) => s.toast)
  const orphanCount = subscriptions.filter((s) => !s.groupId).length
  const refresh = useDesktop((s) => s.refresh)
  const go = useViewNavigate()
  const [editing, setEditing] = useState<Subscription | null>(null)
  const [newGroup, setNewGroup] = useState("")
  const [importing, setImporting] = useState(false)

  const shareable = subscriptions.filter((s) => !s.channelKey.startsWith("rsshub:") && s.info?.url).length

  async function onImportOpml() {
    setImporting(true)
    try {
      const xml = await pickOpmlFile()
      if (xml === null) return // 取消
      const r = await doImportOpml(xml)
      if (r.added === 0 && r.skipped === 0) {
        toast("error", "导入失败", "文件里没找到可用的 RSS 订阅。")
      } else {
        toast("ok", `导入 ${r.added} 条订阅`, `跳过 ${r.skipped} 条${r.failed ? `,失败 ${r.failed} 条` : ""}。`)
      }
    } catch (e) {
      toast("error", "导入失败", e instanceof Error ? e.message : String(e))
    } finally {
      setImporting(false)
    }
  }

  return (
    <>
      <SideCardOPML {...{ onImportOpml, importing, doExportOpml, shareable, toast }} />

      <SideCardGroups
        {...{
          groups,
          subscriptions,
          orphanCount,
          autoGroupByKind,
          renameGroup,
          removeGroup,
          addGroup,
          newGroup,
          setNewGroup,
          autoGroupOnAdd: settings?.autoGroupOnAdd ?? false,
          setAutoGroupOnAdd: (v: boolean) => void setSetting("autoGroupOnAdd", v),
        }}
      />

      <SubscriptionTable
        {...{ subscriptions, groups, refresh, setEditing, go, toggleSubEnabled, removeSubscription }}
      />

      <EditSubscriptionDialog sub={editing} onClose={() => setEditing(null)} />
    </>
  )
}

/* ── 下面是本 tab 的三块:OPML / 分组 / 订阅总表 ─────────────────────────
   拆成子组件只为让 render 一眼看清结构(原来是 190 行连排)。 */

function SideCardOPML({
  onImportOpml,
  importing,
  doExportOpml,
  shareable,
  toast,
}: {
  onImportOpml: () => Promise<void>
  importing: boolean
  doExportOpml: () => string
  shareable: number
  toast: (kind: "ok" | "info" | "error", title: string, desc?: string) => void
}) {
  return (
    <SideCard title="OPML 导入/导出" icon="rss">
      <div className="inline-row" style={{ padding: "var(--sp-2) 0" }}>
        <button className="btn btn-secondary" onClick={() => void onImportOpml()} disabled={importing}>
          <Icon name="download" size={14} /> {importing ? "导入中…" : "导入 OPML"}
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => {
            exportOpmlFile(doExportOpml())
            toast("ok", "已导出 OPML", `共 ${shareable} 条带 URL 的订阅,含分组层级。`)
          }}
          disabled={shareable === 0}
        >
          <Icon name="folder" size={14} /> 导出 OPML
        </button>
      </div>
      <p className="setting-help">
        导入按 OPML 的分组层级建分组、逐条落成 RSS 直链（同一地址已订阅则跳过）；
        导出只含 RSS 订阅（直播/社交类不含在内）。
      </p>
    </SideCard>
  )
}

function SideCardGroups({
  groups,
  subscriptions,
  orphanCount,
  autoGroupByKind,
  renameGroup,
  removeGroup,
  addGroup,
  newGroup,
  setNewGroup,
  autoGroupOnAdd,
  setAutoGroupOnAdd,
}: {
  groups: SubscriptionGroup[]
  subscriptions: Subscription[]
  orphanCount: number
  autoGroupByKind: Store["autoGroupByKind"]
  renameGroup: Store["renameGroup"]
  removeGroup: Store["removeGroup"]
  addGroup: Store["addGroup"]
  newGroup: string
  setNewGroup: (v: string) => void
  autoGroupOnAdd: boolean
  setAutoGroupOnAdd: (v: boolean) => void
}) {
  return (
    <SideCard title="分组" icon="folder">
      <div className="setting-row">
        <span className="setting-text">
          添加订阅时按类型自动归类
          <span className="setting-help">
            新建订阅自动放进「视频 / 直播 / 社交 / 播客 / 文章」分组（不存在则创建）；
            手动选择分组时不覆盖。下面的「一键归类」仍可随时整理存量未分组订阅。
          </span>
        </span>
        <span className="setting-control">
          <Switch
            checked={autoGroupOnAdd}
            label="添加订阅时按类型自动归类"
            onChange={setAutoGroupOnAdd}
          />
        </span>
      </div>
      {/* 一键归组:未分组订阅多起来后,逐条改分组太慢。按内容类型归入
          「视频/直播/社交/播客/文章」,带撤销。 */}
      {orphanCount > 0 ? (
        <div className="inline-row" style={{ padding: "var(--sp-2) 0" }}>
          <button className="btn btn-secondary btn-sm" onClick={() => void autoGroupByKind()}>
            <Icon name="sparkle" size={14} /> 把 {orphanCount} 条未分组按类型归类
          </button>
          <span className="t-micro t-dim">可撤销</span>
        </div>
      ) : null}
      {groups.length === 0 ? <p className="rail-empty">还没有分组。建一个把订阅归类。</p> : null}
      {groups.map((g) => {
        const n = subscriptions.filter((s) => s.groupId === g.id).length
        return (
          <div className="setting-row" key={g.id}>
            <span className="setting-text">
              <input
                className="input input-wide"
                defaultValue={g.title}
                aria-label="分组名"
                onBlur={(e) => {
                  const v = e.target.value.trim()
                  // 改空了回退显示旧名,避免留下一个无名分组。
                  if (!v) {
                    e.target.value = g.title
                    return
                  }
                  if (v !== g.title) void renameGroup(g.id, v)
                }}
                onKeyDown={(e) => {
                  // 回车即时提交(只靠 onBlur 时,回车后焦点没动 = 什么都没发生)。
                  if (e.key === "Enter") e.currentTarget.blur()
                }}
              />
            </span>
            <span className="setting-control">
              <span className="t-micro t-dim num" title="组内订阅数">
                {n} 个订阅
              </span>
              <button
                className="icon-btn"
                aria-label="删除分组"
                onClick={() => {
                  if (window.confirm(`删除分组「${g.title}」？组内订阅会移到「未分组」，不会被退订。`)) void removeGroup(g.id)
                }}
              >
                <Icon name="trash" />
              </button>
            </span>
          </div>
        )
      })}
      <div className="inline-row" style={{ padding: "var(--sp-3) 0" }}>
        <input
          className="input input-wide"
          placeholder="新分组名称"
          value={newGroup}
          aria-label="新分组名称"
          onChange={(e) => setNewGroup(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !isImeComposing(e) && newGroup.trim()) {
              void addGroup(newGroup.trim())
              setNewGroup("")
            }
          }}
        />
        <button
          className="btn btn-secondary"
          disabled={!newGroup.trim()}
          onClick={() => {
            void addGroup(newGroup.trim())
            setNewGroup("")
          }}
        >
          <Icon name="plus" size={14} /> 新建
        </button>
      </div>
    </SideCard>
  )
}

function SubscriptionTable({
  subscriptions,
  groups,
  refresh,
  setEditing,
  go,
  toggleSubEnabled,
  removeSubscription,
}: {
  subscriptions: Subscription[]
  groups: SubscriptionGroup[]
  refresh: Store["refresh"]
  setEditing: (s: Subscription) => void
  go: (id: string) => void
  toggleSubEnabled: Store["toggleSubEnabled"]
  removeSubscription: Store["removeSubscription"]
}) {
  return (
    <SideCard title={`订阅 ${subscriptions.length}`} icon="rss" blockKey="settings:subscriptions">
      {subscriptions.length === 0 ? (
        <StateBlock icon="rss" tight title="还没有订阅" text="到「发现」浏览,或点侧栏的 + 添加。" />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: "40%" }}>名称</th>
              <th>渠道</th>
              <th>分组</th>
              <th>状态</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {subscriptions.map((s) => (
              <tr key={s.id}>
                {/* ⚠️ 截断放在**内层按钮**上,不要 `od-truncate` 到 `<td>` 本体:
                    td 是 display:block + maxWidth 260,会小于列宽(40%)→ 行分隔线在
                    该列断开,右半截成空白条。td 保持 table-cell 撑满列宽。 */}
                <td style={{ maxWidth: 0 }}>
                  <button
                    className="btn btn-quiet btn-sm od-truncate"
                    style={{ maxWidth: "100%" }}
                    onClick={() => go(s.id)}
                    title={s.title}
                  >
                    {s.title}
                  </button>
                </td>
                <td className="t-micro t-dim mono">{s.channelKey}</td>
                <td className="t-small t-muted">{groups.find((g) => g.id === s.groupId)?.title ?? "未分组"}</td>
                <td>{s.enabled ? <span className="tag tag-ok">启用</span> : <span className="tag">停用</span>}</td>
                <td>
                  <div className="cell-actions">
                    <button className="icon-btn sm" aria-label="刷新" onClick={() => void refresh(s.id)}>
                      <Icon name="refresh" size={14} />
                    </button>
                    <button className="icon-btn sm" aria-label="编辑" onClick={() => setEditing(s)}>
                      <Icon name="edit" size={14} />
                    </button>
                    <Menu
                      trigger={
                        <button className="icon-btn sm" aria-label="更多">
                          <Icon name="more" size={14} />
                        </button>
                      }
                    >
                      <MenuItem icon="rss" onSelect={() => toggleSubEnabled(s.id)}>
                        {s.enabled ? "停用" : "启用"}
                      </MenuItem>
                      <MenuItem icon="folder" onSelect={() => go(`group:${s.groupId ?? ""}`)} disabled={!s.groupId}>
                        查看所在分组
                      </MenuItem>
                      <MenuSeparator />
                      <MenuItem
                        danger
                        icon="trash"
                        onSelect={() => {
                          if (window.confirm(`退订「${s.title}」？内容缓存也会一并删除。`)) void removeSubscription(s.id)
                        }}
                      >
                        退订
                      </MenuItem>
                    </Menu>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </SideCard>
  )
}
