/**
 * AddFeedDialog — 添加订阅弹窗。
 *
 * 用 radix Dialog(primitive)替代裸 div modal——补焦点陷阱 / ESC 关闭 / ARIA
 * dialog 角色;样式仍走 tailwind(shadcn 语义令牌)。数据来自 crawler 的 channel
 * 注册表:`listChannels()` 选渠道,按 `sourceInfoTpl` 动态渲染参数字段;
 * 有 `defaultInfo` 的 channel 显示「一键订阅」。提交走
 * useDesktop.addSubscription → dl.subscriptions.add + refresh。
 */
import { useEffect, useMemo, useState } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { X, Loader2 } from "lucide-react"
import { useDesktop } from "../store.ts"

/** 输入框统一样式(shadcn 风格,多处复用)。 */
const inputCls =
  "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"

export function AddFeedDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const addSubscription = useDesktop((s) => s.addSubscription)
  // 渠道列表走 core DataLayer(apps 不直接碰 crawler 注册表);dl 就绪后填充。
  const dl = useDesktop((s) => s.dl)
  const channels = useMemo(() => dl?.listChannels() ?? [], [dl])
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
    <Dialog.Root open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      {/* Portal:弹到 body 顶层,不受三栏 overflow 影响 */}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 w-[420px] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background shadow-xl focus:outline-none"
        >
          {/* 头 */}
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <Dialog.Title className="text-sm font-semibold">添加订阅</Dialog.Title>
            <Dialog.Close className="p-1 hover:bg-muted rounded" disabled={busy}>
              <X className="h-4 w-4 text-muted-foreground" />
            </Dialog.Close>
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
              className={inputCls}
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
              className={inputCls}
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
                    className={inputCls}
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
          <Dialog.Close
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
            disabled={busy}
          >
            取消
          </Dialog.Close>
          <button
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
            onClick={handleSubmit}
            disabled={busy || !channelKey}
          >
            {busy ? <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> : null}
            添加
          </button>
        </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
