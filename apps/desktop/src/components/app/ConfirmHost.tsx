/**
 * ConfirmHost —— 常驻的异步确认框宿主（见 `lib/confirm.ts` 的 `confirmAction`）。
 * 挂在 App 根部；业务代码不直接渲染它。
 */

import { useSyncExternalStore } from "react"

import { getConfirmRequest, settleConfirmFor, subscribeConfirm } from "../../lib/confirm.ts"
import { ConfirmDialog } from "../ui/AlertDialog.tsx"

export function ConfirmHost() {
  const req = useSyncExternalStore(subscribeConfirm, getConfirmRequest, getConfirmRequest)
  return (
    <ConfirmDialog
      key={req?.id ?? 0}
      open={!!req}
      title={req?.title ?? ""}
      desc={req?.desc}
      confirmLabel={req?.confirmLabel}
      cancelLabel={req?.cancelLabel}
      danger={req?.danger}
      onConfirm={() => req && settleConfirmFor(req.id, true)}
      onCancel={() => req && settleConfirmFor(req.id, false)}
    />
  )
}
