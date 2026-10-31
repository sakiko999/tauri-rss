/**
 * 兼容层：浮层原语的旧导入路径。
 *
 * 实现已收到 `components/ui/`（Radix 只许在封装层 import，见 `scripts/radix-boundary.check.ts`）。
 * 新代码直接从 `components/ui/<原语>.tsx` 导入；这里只为既有 14 个调用点保留，等它们
 * 迁完即可删除。
 */

export { Modal } from "./ui/Dialog.tsx"
export { Menu, MenuItem, MenuSeparator } from "./ui/Menu.tsx"
export { Select } from "./ui/Select.tsx"
export { Switch } from "./ui/Switch.tsx"
