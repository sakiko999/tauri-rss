/**
 * Toaster —— 提示条容器(portal 到 #toast-root,避免被 .app-shell 的 overflow 裁剪)。
 */
import { createPortal } from "react-dom"
import { useDesktop } from "../store/index.ts"
import { Icon } from "./Icon.tsx"

const ICON: Record<string, string> = {
  ok: "checkCircle",
  warn: "warning",
  error: "alert",
  info: "info",
}

export function Toaster() {
  const toasts = useDesktop((s) => s.toasts)
  const dismiss = useDesktop((s) => s.dismissToast)
  const host = document.getElementById("toast-root")
  if (!host) return null
  return createPortal(
    <>
      {toasts.map((t) => (
        <div key={t.id} className="toast" data-tone={t.tone} role={t.tone === "error" ? "alert" : "status"}>
          <Icon name={ICON[t.tone] ?? "info"} size={15} />
          <div className="toast-body">
            <span className="toast-title">{t.title}</span>
            {t.text ? <span className="toast-text">{t.text}</span> : null}
          </div>
          <button className="icon-btn sm" aria-label="关闭提示" onClick={() => dismiss(t.id)}>
            <Icon name="close" size={13} />
          </button>
        </div>
      ))}
    </>,
    host,
  )
}
