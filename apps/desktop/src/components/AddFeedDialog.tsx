/**
 * AddFeedDialog — 添加订阅弹窗(轻量自绘 modal,不引入 radix)。
 *
 * 数据来自 crawler 的 channel 注册表:`listChannels()` 选渠道,
 * 按 `sourceInfoTpl` 动态渲染参数字段;有 `defaultInfo` 的 channel 显示「一键订阅」。
 * 提交走 useDesktop.addSubscription → dl.subscriptions.add + refresh。
 */
import { useEffect, useMemo, useState } from "react"
import { listChannels } from "@tauri-playground/crawler"
import { X, Loader2 } from "lucide-react"
import { useDesktop } from "../store.ts"

export function AddFeedDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const addSubscription = useDesktop((s) => s.addSubscription)
  const channels = useMemo(() => listChannels(), [])
  const [channelKey, setChannelKey] = useState("")
  const [values, setValues] = useState<Record<string, string>>({})
  const [title, setTitle] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const channel = channels.find((c) => c.key === channelKey)

  // 打开时重置 + 默认选中第一个有 defaultInfo 的 channel
  useEffect(() => {
    if (!open) return
    setError("")
    setBusy(false)
    const first = channels.find((c) => c.defaultInfo) ?? channels[0]
    if (first) {
      setChannelKey(first.key)
      setValues({ ...(first.defaultInfo ?? {}) })
      setTitle(first.name)
    }
  }, [open, channels])

  if (!open) return null

  const fields = channel?.sourceInfoTpl ?? []
  const canOneClick = !!channel?.defaultInfo

  async function handleSubmit() {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => !busy && onOpenChange(false)}>
      <div
        className="w-[420px] max-w-[90vw] rounded-lg border border-border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头 */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">添加订阅</h2>
          <button className="p-1 hover:bg-muted rounded" onClick={() => onOpenChange(false)} disabled={busy}>
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <div className="space-y-3 px-4 py-4">
          {/* 渠道选择 */}
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">渠道</label>
            <select
              value={channelKey}
              onChange={(e) => {
                const ch = channels.find((c) => c.key === e.target.value)
                setChannelKey(e.target.value)
                setValues({ ...(ch?.defaultInfo ?? {}) })
                setTitle(ch?.name ?? "")
              }}
              className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {channels.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name} ({c.key})
                </option>
              ))}
            </select>
          </div>

          {/* 标题 */}
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">订阅标题</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={channel?.name ?? ""}
              className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* 参数(sampleInfoTpl) */}
          {fields.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">参数</div>
              {fields.map((f) => (
                <div key={f.key}>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    {f.label}
                    {f.required ? <span className="text-destructive"> *</span> : null}
                  </label>
                  <input
                    value={values[f.key] ?? ""}
                    placeholder={f.placeholder}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              ))}
            </div>
          )}

          {/* 一键订阅提示 */}
          {canOneClick && fields.length > 0 && (
            <p className="text-xs text-muted-foreground">
              该渠道带默认参数,可留空直接订阅一个合理实例。
            </p>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        {/* 脚 */}
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            取消
          </button>
          <button
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
            onClick={handleSubmit}
            disabled={busy || !channelKey}
          >
            {busy ? <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> : null}
            添加
          </button>
        </div>
      </div>
    </div>
  )
}
