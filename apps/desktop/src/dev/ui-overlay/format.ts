/** 条目格式化（纯函数）—— 文本清单 / 精简 JSON。 */

import type { OverlayEntry, PublicEntry } from "./types.ts"

export function toPublicEntry(e: OverlayEntry): PublicEntry {
  const { el: _el, ...rest } = e
  return rest
}

/** 单条 JSON：字段尽量短，不包含输入值/敏感内容。 */
export function toJsonItem(e: OverlayEntry): Record<string, unknown> {
  const r = e.rect
  return {
    n: e.n,
    block: e.block || undefined,
    blockName: e.blockName || undefined,
    tag: e.tag,
    role: e.role,
    name: e.name,
    id: e.id || undefined,
    cls: e.cls || undefined,
    sel: e.sel,
    rect: [Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h)],
    comp: e.comp || undefined,
    type: e.type || undefined,
    disabled: e.disabled || undefined,
    stable: e.stable ? undefined : false,
  }
}

/** 单条文本（信息卡 / copy text）。 */
export function formatEntry(e: OverlayEntry): string {
  const r = e.rect
  const bits = [
    `#${e.n}`,
    e.block ? `[block${e.blockName ? `:${e.blockName}` : ""}]` : "",
    e.tag,
    e.role ? `role="${e.role}"` : "",
    e.name ? `"${e.name}"` : "(unnamed)",
    `@ ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.w)}×${Math.round(r.h)}`,
    e.sel,
  ].filter(Boolean)
  return bits.join("  ")
}

/** 当前清单的纯文本版（按视觉顺序）。 */
export function formatText(entries: readonly OverlayEntry[]): string {
  return entries.map(formatEntry).join("\n")
}
