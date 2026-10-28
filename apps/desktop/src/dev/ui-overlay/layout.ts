/**
 * 标签定位 —— 纯函数（无 DOM），供自检复用。
 *
 * 优先放到元素外侧；空间不足时才放内侧。所有候选位置都会 clamp 到视口内，
 * 并避开已放置的标签/工具栏。
 */

import type { Box } from "./types.ts"

const GAP = 3
const PAD = 1

function overlaps(a: Box, b: Box): boolean {
  return !(a.x + a.w + PAD <= b.x || b.x + b.w + PAD <= a.x || a.y + a.h + PAD <= b.y || b.y + b.h + PAD <= a.y)
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

interface Size {
  w: number
  h: number
}

/** 目标矩形 + 标签尺寸 + 视口 + 已占用矩形 → 标签左上角坐标。 */
export function chooseLabelPosition(
  target: Box,
  label: Size,
  viewport: Size,
  occupied: readonly Box[] = [],
): { x: number; y: number } {
  const outside: Array<{ x: number; y: number }> = [
    // 右上外侧（小元素首选）
    { x: target.x + target.w + GAP, y: target.y },
    // 右下外侧
    { x: target.x + target.w - label.w, y: target.y + target.h + GAP },
    // 左下外侧
    { x: target.x, y: target.y + target.h + GAP },
    // 左上外侧
    { x: target.x, y: target.y - label.h - GAP },
    // 右侧居中
    { x: target.x + target.w + GAP, y: target.y + (target.h - label.h) / 2 },
  ]
  const inside: Array<{ x: number; y: number }> = [
    // 左上内侧
    { x: target.x + 2, y: target.y + 2 },
    // 右上内侧
    { x: target.x + target.w - label.w - 2, y: target.y + 2 },
    // 顶部居中
    { x: target.x + (target.w - label.w) / 2, y: target.y + 2 },
  ]

  // 大元素优先内侧（不挡关键内容）；小元素优先外侧（不遮住目标）。
  const roomy = target.w >= 44 && target.h >= 26
  const candidates = roomy ? [...inside, ...outside] : [...outside, ...inside]

  let fallback: { x: number; y: number } | null = null
  for (const c of candidates) {
    const x = clamp(Math.round(c.x), 0, Math.max(0, viewport.w - label.w))
    const y = clamp(Math.round(c.y), 0, Math.max(0, viewport.h - label.h))
    const box: Box = { x, y, w: label.w, h: label.h }
    if (!fallback) fallback = { x, y }
    if (!occupied.some((o) => overlaps(box, o))) return { x, y }
  }
  return fallback ?? { x: 0, y: 0 }
}
