/**
 * MediaDanmakuButton —— 弹幕开关(播放器控件栏)。
 *
 * 纯受控:enabled 来自宿主(播放页的临时开关),点击调 onToggle。
 * 只控制「是否把弹幕流交给渲染层」,不负责解析/建连 —— 那是 PlayableMedia 的
 * showDanmaku 语义。control 缺失时不渲染(无弹幕流 / 全局设置已关闭)。
 */
import { DanmakuIcon, DanmakuOffIcon } from "../icons.tsx"

export interface DanmakuControl {
  enabled: boolean
  onToggle: () => void
}

export function MediaDanmakuButton({
  control,
  className = "rounded p-1 hover:bg-white/20",
}: {
  control?: DanmakuControl
  className?: string
}) {
  if (!control) return null
  return (
    <button
      type="button"
      aria-label={control.enabled ? "关闭弹幕" : "开启弹幕"}
      aria-pressed={control.enabled}
      onClick={control.onToggle}
      className={`${className} ${control.enabled ? "" : "text-white/50"}`}
    >
      {control.enabled ? <DanmakuIcon className="h-5 w-5" /> : <DanmakuOffIcon className="h-5 w-5" />}
    </button>
  )
}
