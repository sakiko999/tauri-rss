/**
 * Dialog —— 模态框封装（radix Dialog + 设计系统类名）。
 *
 * ⚠️ 本目录是**唯一**允许 import Radix 的地方（`scripts/radix-boundary.check.ts`）。
 * 业务组件只 import 这里；换 Base UI 时只改封装层。
 */

import * as DialogPrimitive from "radix-ui/dialog"
import type { ReactNode } from "react"

import { overlayBlock } from "../../lib/uiOverlay.ts"
import { IconButton } from "../Button.tsx"
import { Icon } from "../Icon.tsx"

export function Modal({
  open,
  onOpenChange,
  title,
  desc,
  children,
  footer,
  size = "default",
  flush = false,
  dismissable = true,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  desc?: string
  children: ReactNode
  footer?: ReactNode
  size?: "default" | "wide"
  /** 内容自管内边距(如社交详情:滚动交给内层信息列,body 不滚不 pad)。 */
  flush?: boolean
  dismissable?: boolean
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => (dismissable || !o ? onOpenChange(o) : undefined)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="scrim" />
        {/* ⚠️ Radix 的 Content 与 Overlay 是**兄弟**节点,不是子节点——不能靠 .scrim 的
            grid 居中,必须自己绝对居中。 */}
        <DialogPrimitive.Content
          // ⚠️ 不手写 aria-describedby:Radix 在存在 Description 时**自动**接线
          // (实测 value=radix-_r_x_);无 Description 时才需 `""` 抑制 a11y 警告。
          aria-describedby={desc ? undefined : ""}
          className={`modal${size === "wide" ? " modal-wide" : ""}${flush ? " modal-flush" : ""}`}
          {...overlayBlock("modal", title ? `modal:${title}` : undefined)}
          style={{
            position: "fixed",
            left: "50%",
            top: "50%",
            translate: "-50% -50%",
            zIndex: "var(--z-modal)",
          }}
        >
          <div className="modal-head" {...overlayBlock("modal-head", title ? `modal:head:${title}` : undefined)}>
            <div className="modal-head-text">
              <DialogPrimitive.Title className="modal-title">{title}</DialogPrimitive.Title>
              {desc ? <DialogPrimitive.Description className="modal-desc">{desc}</DialogPrimitive.Description> : null}
            </div>
            <DialogPrimitive.Close asChild>
              <IconButton size="sm" aria-label="关闭">
                <Icon name="close" size={15} />
              </IconButton>
            </DialogPrimitive.Close>
          </div>
          <div className="modal-body" {...overlayBlock("modal-body", title ? `modal:body:${title}` : undefined)}>
            {children}
          </div>
          {footer ? <div className="modal-foot">{footer}</div> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
