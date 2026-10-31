/**
 * ConfirmDialog —— 确认框（radix AlertDialog：焦点陷阱 / Esc / 读屏语义）。
 * 只许在 `components/ui/**` 里 import Radix。
 */

import * as AlertDialogPrimitive from "radix-ui/alert-dialog"

import { Button } from "../Button.tsx"

export function ConfirmDialog({
  open,
  title,
  desc,
  confirmLabel = "确定",
  cancelLabel = "取消",
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  desc?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={(o) => (o ? undefined : onCancel())}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="scrim" />
        <AlertDialogPrimitive.Content
          className="modal"
          style={{
            position: "fixed",
            left: "50%",
            top: "50%",
            translate: "-50% -50%",
            zIndex: "var(--z-modal)",
          }}
        >
          <div className="modal-head">
            <div className="modal-head-text">
              <AlertDialogPrimitive.Title className="modal-title">{title}</AlertDialogPrimitive.Title>
              {desc ? (
                <AlertDialogPrimitive.Description className="modal-desc" style={{ whiteSpace: "pre-line" }}>
                  {desc}
                </AlertDialogPrimitive.Description>
              ) : null}
            </div>
          </div>
          <div className="modal-foot">
            <AlertDialogPrimitive.Cancel asChild>
              <Button variant="quiet" onClick={onCancel}>
                {cancelLabel}
              </Button>
            </AlertDialogPrimitive.Cancel>
            <AlertDialogPrimitive.Action asChild>
              <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </AlertDialogPrimitive.Action>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  )
}
