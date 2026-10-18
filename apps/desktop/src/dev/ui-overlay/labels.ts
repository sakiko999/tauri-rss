/**
 * 标签选择（纯逻辑）—— 决定哪些候选真正渲染标签。
 *
 * 规则：
 *   1. 「仅区块」模式下只渲染 block 候选（控件仍已编号，切回全部时编号不变）。
 *   2. 全部模式下 **区块优先**：超过 400 时先保区块，再按视觉顺序补控件 ——
 *      否则一屏控件很多时，重要的结构区块会被挤掉。
 *   3. 返回的 shown 仍按视觉顺序（y→x）排列，供定位用。
 */
import type { Box } from "./types.ts"

export interface LabelCandidate {
  block?: boolean
  rect: Box
}

export function selectLabels<T extends LabelCandidate>(
  entries: readonly T[],
  blocksOnly: boolean,
  limit: number,
): { shown: T[]; overflow: number } {
  const visible = blocksOnly ? entries.filter((e) => e.block) : entries.slice()
  const ranked = visible.slice().sort((a, b) => Number(!!b.block) - Number(!!a.block))
  const shown = ranked.slice(0, Math.max(0, limit))
  shown.sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)
  return { shown, overflow: Math.max(0, visible.length - shown.length) }
}
