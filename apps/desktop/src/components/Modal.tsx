import * as Dialog from "@radix-ui/react-dialog"
import * as DropdownMenu from "@radix-ui/react-dropdown-menu"
import * as SelectPrimitive from "@radix-ui/react-select"
import * as SwitchPrimitive from "@radix-ui/react-switch"
/**
 * Modal / Menu —— 浮层原语(radix primitive + 设计系统类名)。
 *
 * new_desktop 自造了 mount/modal/confirm/menu(app.js 里手写焦点陷阱与
 * z-index 栈)。React 侧直接用 radix:焦点陷阱 / ESC / ARIA 都是现成的,
 * 只把外观换成 .scrim/.modal/.menu 类。
 */
import type { ReactNode } from "react"

import { overlayBlock } from "../lib/uiOverlay.ts"
import { Icon } from "./Icon.tsx"

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
    <Dialog.Root open={open} onOpenChange={(o) => (dismissable || !o ? onOpenChange(o) : undefined)}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim" />
        {/* ⚠️ Radix 的 Content 与 Overlay 是**兄弟**节点,不是子节点——不能靠 .scrim 的
            grid 居中,必须自己绝对居中。 */}
        <Dialog.Content
          // ⚠️ 不手写 aria-describedby:Radix 在存在 Dialog.Description 时**自动**接线
          // (实测 value=radix-_r_x_);无 Description 时才需 `""` 抑制 a11y 警告。
          // 原来写 `desc ? undefined : undefined` 是恒 undefined 的死表达式(两头一样)。
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
              <Dialog.Title className="modal-title">{title}</Dialog.Title>
              {desc ? <Dialog.Description className="modal-desc">{desc}</Dialog.Description> : null}
            </div>
            <Dialog.Close className="icon-btn sm" aria-label="关闭">
              <Icon name="close" size={15} />
            </Dialog.Close>
          </div>
          <div className="modal-body" {...overlayBlock("modal-body", title ? `modal:body:${title}` : undefined)}>
            {children}
          </div>
          {footer ? <div className="modal-foot">{footer}</div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** 下拉菜单(单选高亮 + 分隔 + 快捷键提示)。 */
export function Menu({
  trigger,
  children,
  align = "end",
}: {
  trigger: ReactNode
  children: ReactNode
  align?: "start" | "end"
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        {/* 定位完全交给 Radix 的 popper wrapper（data-radix-popper-content-wrapper）。
            ⚠️ `.menu` 自己不能写 position: fixed/absolute —— 那会让它脱离 wrapper
            的文档流，wrapper 量成 0×0，flip / available-height / 水平对齐全算错
            （底部行被压成带滚动条的矮菜单，且 align=end 向右溢出）。 */}
        <DropdownMenu.Content
          align={align}
          sideOffset={6}
          // Radix 默认会 flip/shift，但 collisionPadding=0 时会贴着视口边缘。
          // 留 10px 安全边距；空间不足时 CSS 再用 available-height 限高并内部滚动。
          collisionPadding={10}
          className="menu"
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

export function MenuItem({
  onSelect,
  checked,
  hint,
  icon,
  danger,
  children,
  disabled,
}: {
  onSelect?: () => void
  checked?: boolean
  hint?: string
  icon?: string
  danger?: boolean
  children: ReactNode
  disabled?: boolean
}) {
  return (
    <DropdownMenu.Item
      className="menu-item"
      disabled={disabled}
      onSelect={onSelect}
      style={danger ? { color: "var(--danger)" } : undefined}
    >
      {icon ? <Icon name={icon} size={14} /> : null}
      <span className="flex-1">{children}</span>
      {checked ? <Icon name="check" size={13} className="check" /> : null}
      {hint ? <span className="menu-hint">{hint}</span> : null}
    </DropdownMenu.Item>
  )
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="menu-sep" />
}

/** 开关(radix Switch：内建键盘/ARIA/受控语义，样式仍是我们的 .switch)。 */
export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <SwitchPrimitive.Root className="switch" checked={checked} onCheckedChange={onChange} aria-label={label}>
      <SwitchPrimitive.Thumb className="switch-thumb" />
    </SwitchPrimitive.Root>
  )
}

/**
 * Select —— 下拉选择(radix 原语 + 设计系统类名)。
 *
 * ⚠️ 不用原生 `<select>`:它的下拉面板由 WebView/系统渲染,深色主题下弹出的是
 * **亮色系统菜单**且 CSS 管不到(截图里就是这块跳出来最刺眼)。radix 的
 * Select 自己渲染浮层,样式、键盘、读屏行为都归我们。
 */
export function Select({
  value,
  onChange,
  options,
  placeholder,
  id,
  ariaLabel,
}: {
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string; disabled?: boolean }>
  placeholder?: string
  id?: string
  ariaLabel?: string
}) {
  // ⚠️ radix 的 Select.Item 不接受空串 value —— 会把「未分组 / 不归入分组」
  // (value:"")映射成哨兵串 `__none` 再由 onValueChange 回传,调用方保存时拿到
  // `"__none" || null` = `"__none"`(真值)→ 订阅指向一个不存在的分组 id。
  // 故这里在组件边界做哨兵:内部用 `__none` 喂 radix,对外**始终还原成 ""**。
  const NONE = "__none"
  // 有 value="" 的选项(如「继承默认 / 未分组」)时用哨兵,Radix 才能选中它；
  // 没有空值选项时(如「添加渠道」纯占位)直接传 "",Radix 才会显示 placeholder
  // 且每次选择后受控值仍是 ""（触发器回到提示，不会残留上一个渠道名）。
  const hasEmptyOption = options.some((o) => o.value === "")
  return (
    <SelectPrimitive.Root
      value={value || (hasEmptyOption ? NONE : "")}
      onValueChange={(v) => onChange(v === NONE ? "" : v)}
    >
      <SelectPrimitive.Trigger id={id} className="select" aria-label={ariaLabel}>
        <SelectPrimitive.Value placeholder={placeholder ?? "请选择"} />
        <SelectPrimitive.Icon className="select-caret">
          <Icon name="chevronDown" size={15} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content className="select-pop" position="popper" sideOffset={4} collisionPadding={8}>
          <SelectPrimitive.Viewport>
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value || NONE}
                className="select-item"
                value={o.value || NONE}
                disabled={o.disabled}
              >
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="select-check">
                  <Icon name="check" size={13} />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}
