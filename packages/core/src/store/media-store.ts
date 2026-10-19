/**
 * MediaStore — MediaItem 内存存储,可查询 + 可订阅。
 *
 * app 层从这里读内容;refresh 时写入。"智能订阅"(today/unread/starred)
 * 是对全部条目的查询,而非特殊节点——订阅与条目分离即因此。
 */
import type { MediaItem } from "../types/media-item.ts"
import type { MediaQuery } from "../types/query.ts"

export type MediaStoreListener = () => void

export interface MediaStore {
  /** 全部条目(快照副本)。 */
  all(): MediaItem[]
  /** 按 query 过滤,新在前。 */
  query(query?: MediaQuery): MediaItem[]
  /** 用一次新抓取替换某订阅的全部条目。 */
  replace(subscriptionId: string, items: MediaItem[]): void
  /** 追加到某订阅现有条目后(分页加载更多;同订阅内按 id 去重)。
   *  返回**实际新增**条数(0 = 整页都是重复,上游翻页没推进)。 */
  append(subscriptionId: string, items: MediaItem[]): number
  /**
   * patch 单条(如标已读、收藏)。
   *
   * ⚠️ **必须带 subscriptionId**:`item.id` 只在订阅内唯一,同一个 id 会跨订阅出现
   * (实测 `bilibili:7734200` 同时在 `bili:live` 与 `bili:live:hot`)。只按 id 匹配会
   * 把**两个订阅的条目一起改**(在热门榜标已读,手填订阅那条也变已读)。
   */
  patch(subscriptionId: string, id: string, patch: Partial<MediaItem>): void
  /** 订阅 store 变更;返回退订函数。 */
  subscribe(listener: MediaStoreListener): () => void
  /** 丢弃某订阅全部条目(如退订时)。 */
  clear(subscriptionId: string): void
}

function dayStart(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function createMediaStore(now: () => number = Date.now): MediaStore {
  let items: MediaItem[] = []
  const listeners = new Set<MediaStoreListener>()

  function emit(): void {
    for (const l of listeners) l()
  }

  return {
    all() {
      return [...items]
    },

    query(query = {}) {
      const startOfDay = query.today ? dayStart(now()) : -Infinity
      const idSet = query.subscriptionIds ? new Set(query.subscriptionIds) : null
      return items
        .filter((it) => {
          if (query.subscriptionId && it.subscriptionId !== query.subscriptionId) return false
          if (idSet && !idSet.has(it.subscriptionId)) return false
          if (query.today && (it.publishedAt ?? 0) < startOfDay) return false
          if (query.unreadOnly && !it.isUnread) return false
          if (query.starredOnly && !it.isStarred) return false
          return true
        })
        .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
    },

    replace(subscriptionId, next) {
      items = [...items.filter((it) => it.subscriptionId !== subscriptionId), ...next]
      emit()
    },

    append(subscriptionId, next) {
      const existingIds = new Set(items.filter((it) => it.subscriptionId === subscriptionId).map((it) => it.id))
      const fresh = next.filter((it) => !existingIds.has(it.id))
      if (!fresh.length) return 0
      items = [...items, ...fresh]
      emit()
      return fresh.length
    },

    patch(subscriptionId, id, patch) {
      let changed = false
      items = items.map((it) => {
        if (it.id !== id || it.subscriptionId !== subscriptionId) return it
        changed = true
        return { ...it, ...patch } as MediaItem
      })
      if (changed) emit()
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    clear(subscriptionId) {
      const before = items.length
      items = items.filter((it) => it.subscriptionId !== subscriptionId)
      if (items.length !== before) emit()
    },
  }
}
