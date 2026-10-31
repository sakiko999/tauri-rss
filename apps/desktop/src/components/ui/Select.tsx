/**
 * Select —— 下拉选择封装（radix Select + 设计系统类名）。
 *
 * ⚠️ 不用原生 `<select>`:它的下拉面板由 WebView/系统渲染,深色主题下弹出的是
 * **亮色系统菜单**且 CSS 管不到。只许在 `components/ui/**` 里 import Radix。
 */

import * as SelectPrimitive from "radix-ui/select"

import { Icon } from "../Icon.tsx"

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
