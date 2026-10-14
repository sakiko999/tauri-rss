/** 阅读与缓存 tab:功能型设置(core dl.settings,SQLite)+ RSSHub 实例地址。 */
import { useState } from "react"
import { useDesktop } from "../../../store/index.ts"
import { SideCard } from "../../../components/StateBlock.tsx"
import { Switch } from "../../../components/Modal.tsx"
import { Row } from "./Row.tsx"

export function Reading() {
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
