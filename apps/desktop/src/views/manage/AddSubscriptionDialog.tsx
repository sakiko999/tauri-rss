/**
 * AddSubscriptionDialog —— 添加订阅弹窗(radix Dialog + 设计系统类名)。
 *
 * 渠道来自 core `dl.listChannels()`;参数表单由 `sourceInfoTpl` 动态渲染;
 * 带 `defaultInfo` 的渠道可一键订阅。提交走 store.addSubscription(内部
 * dl.addSubscription = add + refresh)。
 */
import { useEffect, useMemo, useState } from "react"
import { useDesktop } from "../../store/index.ts"
import { Modal } from "../../components/Modal.tsx"
import { Icon } from "../../components/Icon.tsx"
import { Banner } from "../../components/StateBlock.tsx"

export function AddSubscriptionDialog({
  open,
  onOpenChange,
  presetKey,
  presetInfo,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 发现页「订阅该分区/搜索词」预置渠道。 */
  presetKey?: string
  presetInfo?: Record<string, string>
}) {
  const dl = useDesktop((s) => s.dl)
  const addSubscription = useDesktop((s) => s.addSubscription)
  const channels = useMemo(() => dl?.listChannels() ?? [], [dl])
  const [channelKey, setChannelKey] = useState("")
  const [values, setValues] = useState<Record<string, string>>({})
  const [title, setTitle] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  // rss: 直链在 desktop 隐藏(URL 代理/原生路由已覆盖),与旧行为一致。
  const builtins = channels.filter((c) => !c.key.startsWith("rsshub:") && !c.key.startsWith("rss:"))
  const rsshub = channels.filter((c) => c.key.startsWith("rsshub:"))
  const channel = channels.find((c) => c.key === channelKey)

  useEffect(() => {
    if (!open) return
    setError("")
    setBusy(false)
    const key = presetKey ?? channels.find((c) => c.defaultInfo)?.key ?? channels[0]?.key ?? ""
    const ch = channels.find((c) => c.key === key)
    setChannelKey(key)
    setValues({ ...(ch?.defaultInfo ?? {}), ...(presetKey ? presetInfo : {}) })
    setTitle(ch?.name ?? "")
  }, [open, channels, presetKey, presetInfo])

  const fields = channel?.sourceInfoTpl ?? []

  async function submit() {
    if (!channelKey) return
    setBusy(true)
    setError("")
    try {
      const id = await addSubscription(channelKey, title.trim() || channel?.name || channelKey, values)
      if (!id) throw new Error("数据层未初始化")
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="添加订阅"
      desc="选择渠道并填写参数;留空则用渠道默认值。"
      dismissable={!busy}
      footer={
        <>
          <span className="t-micro t-dim" style={{ flex: 1 }}>
            {channelKey ? `渠道 ${channelKey}` : "尚未选择渠道"}
          </span>
          <button className="btn btn-secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            取消
          </button>
          <button className="btn btn-primary" disabled={busy || !channelKey} onClick={submit}>
            {busy ? <Icon name="loader" size={14} className="animate-spin" /> : null} 添加
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field-label" htmlFor="add-channel">
          渠道
        </label>
        <select
          id="add-channel"
          className="select"
          value={channelKey}
          onChange={(e) => {
            const ch = channels.find((c) => c.key === e.target.value)
            setChannelKey(e.target.value)
            setValues({ ...(ch?.defaultInfo ?? {}) })
            setTitle(ch?.name ?? "")
          }}
        >
          <optgroup label="内置">
            {builtins.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name} ({c.key})
              </option>
            ))}
          </optgroup>
          {rsshub.length > 0 ? (
            <optgroup label="RSSHub">
              {rsshub.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name} ({c.key})
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="add-title">
          订阅标题
        </label>
        <input
          id="add-title"
          className="input"
          value={title}
          placeholder={channel?.name ?? ""}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      {fields.length > 0 ? (
        <div className="stack" style={{ gap: "var(--sp-4)" }}>
          <span className="field-help">参数</span>
          {fields.map((f) => (
            <div className="field" key={f.key}>
              <label className="field-label" htmlFor={`add-${f.key}`}>
                {f.label}
                {f.required ? <span className="field-req">*</span> : null}
              </label>
              <input
                id={`add-${f.key}`}
                className="input"
                value={values[f.key] ?? ""}
                placeholder={f.placeholder}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
            </div>
          ))}
        </div>
      ) : null}

      {channel?.defaultInfo && fields.length > 0 ? (
        <Banner tone="info">该渠道带默认参数，可直接订阅一个合理实例。</Banner>
      ) : null}
      {channel?.loginable ? <Banner tone="warn" icon="lock">该渠道需要登录，请先在「账号与凭证」里扫码或填 cookie。</Banner> : null}
      {error ? <Banner tone="error" icon="alert">{error}</Banner> : null}
    </Modal>
  )
}
