/**
 * SettingsPage —— 设置外壳:深链解析 + tab 切换。
 *
 * 五个 tab 各在自己的文件里(views/manage/settings/):
 *   Appearance(表现型偏好,usePrefs)· Reading(缓存/RSSHub)· Playback ·
 *   Subscriptions(OPML + 分组 + 订阅 CRUD)· Diagnostics(存储与诊断)。
 * 本文件只保留 tab 定义与外壳 —— 原来它们全挤在一个 555 行的组件里。
 */
import { useState } from "react"
import { useSearchParams } from "react-router"
import { Icon } from "../../components/Icon.tsx"
import { Appearance } from "./settings/Appearance.tsx"
import { Reading } from "./settings/Reading.tsx"
import { Playback } from "./settings/Playback.tsx"
import { Subscriptions } from "./settings/Subscriptions.tsx"
import { Diagnostics } from "./settings/Diagnostics.tsx"

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
