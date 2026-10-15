/**
 * EditSubscriptionDialog —— 编辑一条订阅(标题 / 分组 / 独立刷新间隔 / 启用)。
 *
 * 抽成共享组件的原因:设置页和**侧栏订阅行**都要用它。之前管理动作只在设置页有,
 * 用户在侧栏看到想改的订阅只能记住名字再跳页找。
 *
 * 分组与写库都从 store 自取(不 props 透传),这样任意位置一句
 * `<EditSubscriptionDialog sub={s} onClose={...} />` 就能用。
 */
import { useState } from "react"
import type { Subscription } from "@tauri-playground/core"
import { useDesktop } from "../../store/index.ts"
import { Modal, Select, Switch } from "../../components/Modal.tsx"
import { isImeComposing } from "../../lib/ime.ts"

export function EditSubscriptionDialog({ sub, onClose }: { sub: Subscription | null; onClose: () => void }) {
  const groups = useDesktop((s) => s.groups)
  const updateSubscription = useDesktop((s) => s.updateSubscription)
  const toast = useDesktop((s) => s.toast)
  const [title, setTitle] = useState("")
  const [groupId, setGroupId] = useState("")
  const [ttl, setTtl] = useState(0)
  const [enabled, setEnabled] = useState(true)
  const [busy, setBusy] = useState(false)

  // 打开时同步一次(sub 变化 → 重置表单)。
  const [prevId, setPrevId] = useState<string | null>(null)
  if (sub && sub.id !== prevId) {
    setPrevId(sub.id)
    setTitle(sub.title)
    setGroupId(sub.groupId ?? "")
    setTtl(sub.refreshIntervalSec ? Math.round(sub.refreshIntervalSec / 60) : 0)
    setEnabled(sub.enabled)
  }
  if (!sub) {
    if (prevId) setPrevId(null)
    return null
  }

  async function save() {
    if (!sub) return
    setBusy(true)
    try {
      await updateSubscription(sub.id, {
        title: title.trim() || sub.title,
        groupId: groupId || null,
        refreshIntervalSec: ttl > 0 ? ttl * 60 : undefined,
        enabled,
      })
      toast("ok", `已保存「${title.trim() || sub.title}」`)
      onClose()
    } catch (e) {
      // ⚠️ 旧实现 `void onSave(...)`:失败被吞,弹窗不关也不报错,用户以为存上了。
      toast("error", "保存失败", e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => !o && !busy && onClose()}
      title="编辑订阅"
      desc={sub.channelKey}
      dismissable={!busy}
      footer={
        <>
          <span className="spacer" />
          <button className="btn btn-secondary" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            保存
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field-label" htmlFor="ed-title">
          标题
        </label>
        <input
          id="ed-title"
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !isImeComposing(e)) void save()
          }}
        />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="ed-group">
          分组
        </label>
        <Select
          id="ed-group"
          value={groupId}
          onChange={setGroupId}
          placeholder="未分组"
          options={[{ value: "", label: "未分组" }, ...groups.map((g) => ({ value: g.id, label: g.title }))]}
        />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="ed-ttl">
          独立刷新间隔（分钟，0 = 跟随全局）
        </label>
        <input
          id="ed-ttl"
          type="number"
          className="input input-number"
          value={ttl}
          min={0}
          onChange={(e) => setTtl(Number(e.target.value))}
        />
      </div>
      <div className="setting-row">
        <span className="setting-text">
          <span className="setting-label">启用</span>
          <span className="setting-help">停用后不参与刷新,但已缓存内容仍可阅读。</span>
        </span>
        <span className="setting-control">
          <Switch checked={enabled} label="启用" onChange={setEnabled} />
        </span>
      </div>
    </Modal>
  )
}
