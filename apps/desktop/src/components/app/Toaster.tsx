/**
 * Toaster —— 提示条容器(portal 到 #toast-root,避免被 .app-shell 的 overflow 裁剪)。
 *
 * ⚠️ **退场要等动画放完**:store 的 `dismissToast` 只打 `closing` 标记,元素留下播
 * CSS 退场动画;动画结束(或兜底超时)后才 `removeToast` 真正卸载。直接过滤会当场
 * 卸载,动画一秒都看不到。兜底超时防「动画被 CSS 关掉/时长令牌变 0」时元素卡住不消失。
 */
import { useEffect } from "react"
import { overlayBlock } from "../../lib/uiOverlay.ts"
import { createPortal } from "react-dom"
import { useDesktop, type Toast } from "../../store/index.ts"
import { Icon } from "../Icon.tsx"
import { motionDurationMs } from "../../lib/motion.ts"

const ICON: Record<string, string> = {
  ok: "checkCircle",
  warn: "warning",
  error: "alert",
  info: "info",
}

/** 单条吐司:退场中挂 `data-closing`,并在时长到点后自我卸载。 */
function ToastItem({ t }: { t: Toast }) {
  const dismiss = useDesktop((s) => s.dismissToast)
  const remove = useDesktop((s) => s.removeToast)

  useEffect(() => {
    if (!t.closing) return
    // 时长**读 CSS 令牌**(三档动效时长不同,写死会让「关闭动效」档白等)。
    const ms = motionDurationMs("base")
    const timer = setTimeout(() => remove(t.id), ms)
    return () => clearTimeout(timer)
  }, [t.closing, t.id, remove])

  return (
    <div
      className="toast"
      data-tone={t.tone}
      data-closing={t.closing ? "" : undefined}
      {...overlayBlock("toast", `toast:${t.id}`)}
      role={t.tone === "error" ? "alert" : "status"}
    >
      <Icon name={ICON[t.tone] ?? "info"} size={15} />
      <div className="toast-body">
        <span className="toast-title">{t.title}</span>
        {t.text ? <span className="toast-text">{t.text}</span> : null}
      </div>
      {/* 可撤销操作的入口(如「一键归组」→[撤销])。 */}
      {t.action ? (
        <button
          className="toast-action"
          onClick={() => {
            dismiss(t.id)
            t.action!.run()
          }}
        >
          {t.action.label}
        </button>
      ) : null}
      <button className="icon-btn sm" aria-label="关闭提示" onClick={() => dismiss(t.id)}>
        <Icon name="close" size={13} />
      </button>
    </div>
  )
}

export function Toaster() {
  const toasts = useDesktop((s) => s.toasts)
  const host = document.getElementById("toast-root")
  if (!host) return null
  return createPortal(
    <>
      {toasts.map((t) => (
        <ToastItem key={t.id} t={t} />
      ))}
    </>,
    host,
  )
}
