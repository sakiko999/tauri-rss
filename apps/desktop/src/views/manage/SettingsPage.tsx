/**
 * SettingsPage —— 设置。两个来源:
 *   - **表现型**(主题/密度/字号/动效/行宽)→ usePrefs(localStorage,首帧脚本要同步读);
 *   - **功能型**(刷新间隔/自动播放/弹幕/画质/图片代理)→ core `dl.settings`(SQLite 持久化)。
 * 另含订阅与分组管理(CRUD)与存储诊断。
 */
import { useState } from "react"
import { useSearchParams } from "react-router"
import type { Subscription } from "@tauri-playground/core"
import { useDesktop } from "../../store/index.ts"
import { usePrefs, type Density, type Measure, type Motion, type ThemeMode } from "../../store/prefs.ts"
import { SideCard, StateBlock } from "../../components/StateBlock.tsx"
import { Icon } from "../../components/Icon.tsx"
import { Menu, MenuItem, MenuSeparator, Switch } from "../../components/Modal.tsx"
import { useViewNavigate } from "../../router.tsx"
import { EditSubscriptionDialog } from "./EditSubscriptionDialog.tsx"
import { exportOpmlFile, pickOpmlFile } from "../../lib/opml-file.ts"

type Tab = "appearance" | "reading" | "playback" | "subscriptions" | "diagnostics"

const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: "appearance", label: "外观", icon: "sun" },
  { id: "reading", label: "阅读与缓存", icon: "type" },
  { id: "playback", label: "播放", icon: "play" },
  { id: "subscriptions", label: "订阅与分组", icon: "rss" },
  { id: "diagnostics", label: "存储与诊断", icon: "database" },
]

export function SettingsPage() {
  // 支持深链:侧栏/命令面板的「管理分组」跳到 page:settings?tab=subscriptions,
  // 否则会落在默认的「外观」上 —— 点「管理分组」看到主题设置是明显的入口错位。
  const [sp] = useSearchParams()
  const initial = (sp.get("tab") as Tab) || "appearance"
  const [tab, setTab] = useState<Tab>(TABS.some((t) => t.id === initial) ? initial : "appearance")
  return (
    <div className="page">
      <div className="scroll-area page-scroll">
        <div className="page-wrap">
          <h1 className="page-title">设置</h1>
          <div className="segmented" style={{ marginBlock: "var(--sp-5)" }}>
            {TABS.map((t) => (
              <button key={t.id} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
                <Icon name={t.icon} size={13} /> {t.label}
              </button>
            ))}
          </div>

          {tab === "appearance" ? <Appearance /> : null}
          {tab === "reading" ? <Reading /> : null}
          {tab === "playback" ? <Playback /> : null}
          {tab === "subscriptions" ? <Subscriptions /> : null}
          {tab === "diagnostics" ? <Diagnostics /> : null}
        </div>
      </div>
    </div>
  )
}

/** 通用设置行(标签 + 说明 + 控件)。 */
function Row({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="setting-row">
      <span className="setting-text">
        <span className="setting-label">{label}</span>
        {help ? <span className="setting-help">{help}</span> : null}
      </span>
      <span className="setting-control">{children}</span>
    </div>
  )
}

function Appearance() {
  const p = usePrefs()
  return (
    <SideCard title="外观" icon="sun">
      <Row label="主题" help="深色为默认;「跟随系统」按操作系统的明暗设置切换。">
        <div className="segmented">
          {(["dark", "light", "system"] as ThemeMode[]).map((t) => (
            <button key={t} aria-pressed={p.theme === t} onClick={() => p.set({ theme: t })}>
              {{ dark: "深色", light: "浅色", system: "跟随系统" }[t]}
            </button>
          ))}
        </div>
      </Row>
      <Row label="密度" help="影响卡片内边距、网格间距与列表行高。">
        <div className="segmented">
          {(["compact", "standard", "relaxed"] as Density[]).map((d) => (
            <button key={d} aria-pressed={p.density === d} onClick={() => p.set({ density: d })}>
              {{ compact: "紧凑", standard: "标准", relaxed: "宽松" }[d]}
            </button>
          ))}
        </div>
      </Row>
      <Row label="正文字号" help="文章详情的正文尺寸(A− / A+ 也会改它)。">
        <div className="range">
          <input
            type="range"
            min={13}
            max={24}
            value={p.fontSize}
            aria-label="正文字号"
            onChange={(e) => p.set({ fontSize: Number(e.target.value) })}
          />
          <span className="range-value num">{p.fontSize}px</span>
        </div>
      </Row>
      <Row label="阅读行宽" help="正文栏的最大宽度。">
        <div className="segmented">
          {(["narrow", "comfortable", "wide"] as Measure[]).map((m) => (
            <button key={m} aria-pressed={p.measure === m} onClick={() => p.set({ measure: m })}>
              {{ narrow: "窄", comfortable: "适中", wide: "宽" }[m]}
            </button>
          ))}
        </div>
      </Row>
      <Row label="动效" help="「关闭」会去掉过渡与动画（也可由系统的减少动效设置触发）。">
        <div className="segmented">
          {(["off", "standard", "rich"] as Motion[]).map((m) => (
            <button key={m} aria-pressed={p.motion === m} onClick={() => p.set({ motion: m })}>
              {{ off: "关闭", standard: "标准", rich: "更丰富" }[m]}
            </button>
          ))}
        </div>
      </Row>
    </SideCard>
  )
}

function Reading() {
  const settings = useDesktop((s) => s.settings)
  const setSetting = useDesktop((s) => s.setSetting)
  const offline = useDesktop((s) => s.offline)
  const setOffline = useDesktop((s) => s.setOffline)
  // ⚠️ RSSHub 地址用本地草稿,blur/Enter 才落库 —— 直接受控绑 setSetting 会**每敲一键
  // 写一次 SQLite**(整份 settings 读-改-写往返);对比 Add/EditSubscriptionDialog 的
  // 草稿模式。其余控件是离散值(开关/滑杆),本就低频,保持直写。
  const [rsshubDraft, setRsshubDraft] = useState(settings?.rsshubBaseUrl ?? "")
  const [prevBase, setPrevBase] = useState(settings?.rsshubBaseUrl ?? "")
  // settings 迟到位(null→值)或他处改动时同步草稿(打字期间 settings 值不变,不clobber)。
  if (settings && settings.rsshubBaseUrl !== prevBase) {
    setPrevBase(settings.rsshubBaseUrl)
    setRsshubDraft(settings.rsshubBaseUrl)
  }
  const commitRsshub = () => {
    if (settings && rsshubDraft !== settings.rsshubBaseUrl) void setSetting("rsshubBaseUrl", rsshubDraft)
  }
  if (!settings) return null
  return (
    <>
      <SideCard title="阅读与缓存" icon="type">
        <Row label="打开即标已读" help="在列表里点开条目就标记为已读。">
          <Switch checked={settings.markReadOnOpen} label="打开即标已读" onChange={(v) => void setSetting("markReadOnOpen", v)} />
        </Row>
        <Row
          label="自动刷新间隔"
          help="同时也是内容缓存 TTL。TTL 内刷新直接复用缓存,不会发起网络请求(反爬源友好)。"
        >
          <div className="range">
            <input
              type="range"
              min={5}
              max={240}
              step={5}
              value={settings.refreshIntervalMin}
              aria-label="自动刷新间隔"
              onChange={(e) => void setSetting("refreshIntervalMin", Number(e.target.value))}
            />
            <span className="range-value num">{settings.refreshIntervalMin} 分</span>
          </div>
        </Row>
        <Row label="离线模式" help="跳过所有网络抓取,只读本地缓存。">
          <Switch checked={offline} label="离线模式" onChange={setOffline} />
        </Row>
      </SideCard>

      <SideCard title="RSSHub" icon="rss">
        <Row label="实例地址" help="rsshub:* 源的默认 baseUrl;订阅级 info.baseUrl 可覆盖。">
          <input
            className="input input-wide"
            value={rsshubDraft}
            aria-label="RSSHub 实例地址"
            onChange={(e) => setRsshubDraft(e.target.value)}
            onBlur={commitRsshub}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur()
            }}
          />
        </Row>
      </SideCard>
    </>
  )
}

function Playback() {
  const settings = useDesktop((s) => s.settings)
  const setSetting = useDesktop((s) => s.setSetting)
  if (!settings) return null
  return (
    <>
      <SideCard title="播放" icon="play">
        <Row label="自动播放" help="点开播放页立即起播;关闭后停在首帧，点播放按钮开始。">
          <Switch checked={settings.autoplayVideo} label="自动播放" onChange={(v) => void setSetting("autoplayVideo", v)} />
        </Row>
        <Row label="省流模式" help="不加载任何图片（封面/缩略图留占位），慢网络或按流量计费时用。">
          <Switch checked={settings.dataSaver} label="省流模式" onChange={(v) => void setSetting("dataSaver", v)} />
        </Row>
        <Row label="画质" help="本播放器一律选最高清晰度并锁档 —— 隧道转发的带宽估算不可靠，自动降档会骤降且不回升。">
          <span className="tag">锁最高档</span>
        </Row>
      </SideCard>

      <SideCard title="弹幕" icon="captions">
        <Row label="启用弹幕" help="播放页的总开关;播放页内还可临时关闭。">
          <Switch checked={settings.danmakuEnabled} label="启用弹幕" onChange={(v) => void setSetting("danmakuEnabled", v)} />
        </Row>
      </SideCard>

      <SideCard title="图片" icon="image">
        <Row
          label="防盗链图片走隧道"
          help="命中防盗链图床(sinaimg 等)的图片经宿主转发并带上站内 Referer;关闭后这类图会 403。"
        >
          <Switch checked={settings.imageProxy} label="图片代理" onChange={(v) => void setSetting("imageProxy", v)} />
        </Row>
      </SideCard>
    </>
  )
}

function Subscriptions() {
  const subscriptions = useDesktop((s) => s.subscriptions)
  const groups = useDesktop((s) => s.groups)
  const toggleSubEnabled = useDesktop((s) => s.toggleSubEnabled)
  const removeSubscription = useDesktop((s) => s.removeSubscription)
  const addGroup = useDesktop((s) => s.addGroup)
  const renameGroup = useDesktop((s) => s.renameGroup)
  const removeGroup = useDesktop((s) => s.removeGroup)
  const autoGroupByKind = useDesktop((s) => s.autoGroupByKind)
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
        toast("error", "导入失败", "文件里没找到可用的 RSS 订阅(outline 缺 xmlUrl)。")
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
          导入按 OPML 的分组层级建分组、逐条落成 RSS 直链(同 URL 已订阅则跳过)；
          导出只含带 URL 的 RSS 订阅(直播/社交渠道无通用 feed URL，不在其中)。
        </p>
      </SideCard>

      <SideCard title="分组" icon="folder">
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
              if (e.key === "Enter" && newGroup.trim()) {
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

      <SideCard title={`订阅 ${subscriptions.length}`} icon="rss">
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
                  <td>
                    {s.enabled ? <span className="tag tag-ok">启用</span> : <span className="tag">停用</span>}
                  </td>
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

      <EditSubscriptionDialog sub={editing} onClose={() => setEditing(null)} />
    </>
  )
}

function Diagnostics() {
  const allItems = useDesktop((s) => s.allItems)
  const subscriptions = useDesktop((s) => s.subscriptions)
  const refreshErrors = useDesktop((s) => s.refreshErrors)
  const toast = useDesktop((s) => s.toast)
  const [cacheSize, setCacheSize] = useState<number | null>(null)

  async function measureCache() {
    try {
      const keys = await globalThis.appHost.storage.keys("content:")
      let bytes = 0
      for (const k of keys) {
        const v = await globalThis.appHost.storage.get(k)
        bytes += (v?.length ?? 0) * 2 // UTF-16 近似
      }
      setCacheSize(bytes)
    } catch (e) {
      toast("error", "统计失败", String(e))
    }
  }

  async function clearCache() {
    if (
      !window.confirm(
        "清空内容缓存？\n\n" +
          "会删除全部订阅的已抓取内容(TTL 缓存)。已显示的条目保留在列表里," +
          "但下次刷新会真正走网络重新抓取。\n不影响:订阅列表、阅读状态、凭证。",
      )
    )
      return
    try {
      const keys = await globalThis.appHost.storage.keys("content:")
      for (const k of keys) await globalThis.appHost.storage.delete(k)
      setCacheSize(0)
      // ⚠️ 缓存没了但 store 里的条目还在(内存),只是下次刷新会真正走网络。
      // 提示里说清楚,免得用户以为「清空」= 列表清空。
      toast("ok", "内容缓存已清空", `${keys.length} 条。已加载的条目保留在列表里,下次刷新会重新抓取。`)
    } catch (e) {
      toast("error", "清空失败", String(e))
    }
  }

  /** 清掉 CDP 用的 Edge profile(扩展/账户态越养越脏)。走后端命令,不自己删目录。 */
  async function clearBrowserProfile() {
    if (
      !window.confirm(
        "清理浏览器数据?\n\n" +
          "会结束 CDP 用的 Edge 并删除它的 profile(扩展、缓存、登录态)。\n" +
          "影响:微博/小红书等需要重新登录;下次抓取会重建全新 profile。\n" +
          "不影响:订阅、已缓存内容、bilibili 凭证。",
      )
    )
      return
    try {
      const browser = globalThis.appHost.browser
      if (!browser?.resetProfile) throw new Error("当前环境不支持(仅桌面端可用)")
      const r = await browser.resetProfile()
      toast("ok", "浏览器数据已清理", r)
    } catch (e) {
      toast("error", "清理失败", String(e))
    }
  }

  const errs = Object.entries(refreshErrors)

  return (
    <>
      <SideCard title="概况" icon="database">
        <div className="stat-strip" style={{ padding: "var(--sp-3) 0" }}>
          <div className="stack" style={{ gap: 2 }}>
            <span className="t-micro t-dim">条目</span>
            <span className="t-h2 num">{allItems.length}</span>
          </div>
          <div className="stack" style={{ gap: 2 }}>
            <span className="t-micro t-dim">订阅</span>
            <span className="t-h2 num">{subscriptions.length}</span>
          </div>
          <div className="stack" style={{ gap: 2 }}>
            <span className="t-micro t-dim">未读</span>
            <span className="t-h2 num">{allItems.filter((i) => i.isUnread).length}</span>
          </div>
          <div className="stack" style={{ gap: 2 }}>
            <span className="t-micro t-dim">缓存</span>
            <span className="t-h2 num">{cacheSize === null ? "—" : `${Math.round(cacheSize / 1024)} KB`}</span>
          </div>
        </div>
        <div className="inline-row" style={{ padding: "var(--sp-2) 0" }}>
          <button className="btn btn-secondary" onClick={() => void measureCache()}>
            <Icon name="database" size={14} /> 统计内容缓存
          </button>
          <button className="btn btn-danger" onClick={() => void clearCache()}>
            <Icon name="trash" size={14} /> 清空内容缓存
          </button>
        </div>
        <div className="inline-row" style={{ padding: "var(--sp-2) 0" }}>
          <button className="btn btn-secondary" onClick={() => void clearBrowserProfile()}>
            <Icon name="offline" size={14} /> 清理浏览器数据
          </button>
        </div>
        <p className="setting-help">
          清单与阅读状态存在 SQLite（appData/rss.db）；内容缓存是同一 KV 表里的 content:* 记录。
          浏览器数据 = CDP 用的 Edge profile（扩展/账户态会越养越脏），清理后下次抓取重建全新实例，
          微博/小红书需重新登录。
        </p>
      </SideCard>

      <SideCard title={`最近的抓取错误 ${errs.length}`} icon="alert">
        {errs.length === 0 ? (
          <StateBlock icon="checkCircle" tone="ok" tight title="没有错误" text="最近一次刷新全部成功。" />
        ) : (
          <table className="table">
            <tbody>
              {errs.map(([id, msg]) => (
                <tr key={id}>
                  <td style={{ width: 200 }} className="od-truncate">
                    {subscriptions.find((s) => s.id === id)?.title ?? id}
                  </td>
                  <td className="t-small t-muted">{msg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SideCard>
    </>
  )
}