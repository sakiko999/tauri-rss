/**
 * Switch —— 开关封装（radix Switch：键盘/ARIA/受控语义，样式仍是 .switch）。
 * 只许在 `components/ui/**` 里 import Radix。
 */

import * as SwitchPrimitive from "radix-ui/switch"

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
