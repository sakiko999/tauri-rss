/**
 * 把持久化的阅读态(已读/星标/续播位置)回填到条目上。
 *
 * 从 data-layer.ts 拆出(2026-11-01)。
 *
 * ⚠️ 必需的原因:deserialize 每次都按「新条目」处理(isUnread=true、isStarred=false,
 * 无 positionSec),而 refresh 是整批 replace。不回填的话每次刷新/重启,已读、星标、
 * 续播位置都会被抹掉 —— 星标/续播只 patch 内存 store 时尤其明显。
 */

import type { ReadingRepository } from "../repo/reading-repo.ts"
import type { MediaItem } from "../types/media-item.ts"
import { findRecord } from "../types/reading.ts"

export async function applyReadingState(items: MediaItem[], reading: ReadingRepository): Promise<MediaItem[]> {
  if (!items.length) return items
  const map = await reading.getAll().catch(() => null)
  if (!map) return items
  return items.map((it) => {
    // ⚠️ 必须走复合键（带 subscriptionId）——同一条目 id 跨订阅共享已读/星标/续播
    // 是真实存在的（见 types/reading.ts 的 readingKey）。
    const rec = findRecord(map, it.subscriptionId, it.id)
    if (!rec) return it
    const next: Partial<MediaItem> = {}
    if (rec.read && it.isUnread) next.isUnread = false
    if (rec.starred && !it.isStarred) next.isStarred = true
    if (rec.positionSec && !it.positionSec) next.positionSec = rec.positionSec
    if (rec.scrollRatio && !it.scrollRatio) next.scrollRatio = rec.scrollRatio
    // lastReadAt 无条件回填(无「已设则跳过」语义:它就是最近一次时间,应随 reading 更新)。
    if (rec.lastReadAt) next.lastReadAt = rec.lastReadAt
    return Object.keys(next).length ? ({ ...it, ...next } as MediaItem) : it
  })
}
