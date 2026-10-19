/**
 * SettingsPage —— 设置外壳:深链解析 + tab 切换。
 *
 * 七个 tab 各在自己的文件里(views/manage/settings/):
 *   Appearance(表现型偏好,usePrefs)· Reading(缓存/RSSHub)· Network(网络与风控)·
 *   Playback · Subscriptions(OPML + 分组 + 订阅 CRUD)· Diagnostics(存储与诊断)·
 *   About(版本与自动更新)。
 * 本文件只保留 tab 定义与外壳 —— 原来它们全挤在一个 555 行的组件里。
 */
import { useEffect, useState } from "react"
import { useSearchParams } from "react-router"
import { Icon } from "../../components/Icon.tsx"
import { Appearance } from "./settings/Appearance.tsx"
import { Reading } from "./settings/Reading.tsx"
import { Network } from "./settings/Network.tsx"
import { Playback } from "./settings/Playback.tsx"
import { Subscriptions } from "./settings/Subscriptions.tsx"
import { Diagnostics } from "./settings/Diagnostics.tsx"
import { About } from "./settings/About.tsx"
import { overlayBlock } from "../../lib/uiOverlay.ts"

type Tab = "appearance" | "reading" | "network" | "playback" | "subscriptions" | "diagnostics" | "about"

const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: "appearance", label: "外观", icon: "sun" },
  { id: "reading", label: "阅读与缓存", icon: "type" },
  { id: "network", label: "网络与风控", icon: "shield" },
  { id: "playback", label: "播放", icon: "play" },
  { id: "subscriptions", label: "订阅与分组", icon: "rss" },
  { id: "diagnostics", label: "存储与诊断", icon: "database" },
  { id: "about", label: "关于与更新", icon: "info" },
]

export function SettingsPage() {
  // 支持深链:侧栏/命令面板的「管理分组」跳到 page:settings?tab=subscriptions,
  // 否则会落在默认的「外观」上 —— 点「管理分组」看到主题设置是明显的入口错位。
  const [sp] = useSearchParams()
  const initial = (sp.get("tab") as Tab) || "appearance"
  const [tab, setTab] = useState<Tab>(TABS.some((t) => t.id === initial) ? initial : "appearance")
  // URL 变化也要跟随(启动更新 toast 的「查看」会 push ?tab=about —— 若组件已挂载,
  // 只读 useState 初值会让点击「没反应」)。用户点 tab 只改本地 state,不回写 URL。
  useEffect(() => {
    const t = sp.get("tab") as Tab | null
    if (t && TABS.some((x) => x.id === t)) setTab(t)
  }, [sp])
  return (
    <div className="page" {...overlayBlock("settings-page", "page:settings")}>
      <div className="scroll-area page-scroll" {...overlayBlock("settings-scroll", "page:settings:scroll")}>
        <div className="page-wrap" {...overlayBlock("settings-wrap", "page:settings:wrap")}>
          <h1 className="page-title">设置</h1>
          <div className="segmented" style={{ marginBlock: "var(--sp-5)" }} {...overlayBlock("settings-tabs", "page:settings:tabs")}>
            {TABS.map((t) => (
              <button key={t.id} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
                <Icon name={t.icon} size={13} /> {t.label}
              </button>
            ))}
          </div>

          {tab === "appearance" ? <Appearance /> : null}
          {tab === "reading" ? <Reading /> : null}
          {tab === "network" ? <Network /> : null}
          {tab === "playback" ? <Playback /> : null}
          {tab === "subscriptions" ? <Subscriptions /> : null}
          {tab === "diagnostics" ? <Diagnostics /> : null}
          {tab === "about" ? <About /> : null}
        </div>
      </div>
    </div>
  )
}
