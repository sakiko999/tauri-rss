/**
 * MediaStore — MediaItem 内存存储,可查询 + 可订阅。
 *
 * app 层从这里读内容;refresh 时写入。"智能订阅"(today/unread/starred)
 * 是对全部条目的查询,而非特殊节点——订阅与条目分离即因此。
 */

import type { MediaItem } from "../types/media-item.ts"
import type { MediaQuery } from "../types/query.ts"

/**
 * 变更类型。`progress` = 只有续播进度变了（positionSec/scrollRatio/lastReadAt）：
 * 条目对象**原地**更新，数组身份不变 —— 订阅方可以跳过视图重算与重渲染
 * （播放时每 5 秒一次，全量重排 2 万条会卡）。
 */
export type MediaStoreChange = "items" | "progress"

export type MediaStoreListener = (change: MediaStoreChange) => void

/** 只影响「读到哪了」、不影响视图成员与排序的字段。 */
const PROGRESS_FIELDS: ReadonlySet<string> = new Set(["positionSec", "scrollRatio", "lastReadAt"])

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
   * patch 单条(如标已读、收藏、续播进度)。
   *
   * ⚠️ **必须带 subscriptionId**:`item.id` 只在订阅内唯一,同一个 id 会跨订阅出现
   * (实测 `bilibili:7734200` 同时在 `bili:live` 与 `bili:live:hot`)。只按 id 匹配会
   * 把**两个订阅的条目一起改**(在热门榜标已读,手填订阅那条也变已读)。
   *
   * 只改 `PROGRESS_FIELDS` 时原地更新并发 `progress` 事件（见 `MediaStoreChange`）；
   * 否则走写时复制并发 `items` 事件。
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

  function emit(change: MediaStoreChange): void {
    for (const l of listeners) l(change)
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
      // ⚠️ 按 id 去重:「id 在订阅内唯一」是契约,append 早就去重而 replace 没有 ——
      // 渠道产出重复条目(xhs 滚动 state 会把同一笔记追加两次)时,UI 会因重复 React key 报警,
      // 且同一条在列表里出现两次。保留首次出现,顺序不变。
      const seen = new Set<string>()
      const unique = next.filter((it) => !seen.has(it.id) && (seen.add(it.id), true))
      items = [...items.filter((it) => it.subscriptionId !== subscriptionId), ...unique]
      emit("items")
    },

    append(subscriptionId, next) {
      const existingIds = new Set(items.filter((it) => it.subscriptionId === subscriptionId).map((it) => it.id))
      // ⚠️ existingIds 同时当「本批已接受」集合用:同一页内部的重复 id(xhs 置顶组 +
      // 全部组 flat 的案底同源)也不能双写 —— 与 replace 的页内去重对称,
      // addedCount 因此是真实新增数(core 靠它判「游标前进了但 0 新增」)。
      const fresh = next.filter((it) => !existingIds.has(it.id) && (existingIds.add(it.id), true))
      if (!fresh.length) return 0
      items = [...items, ...fresh]
      emit("items")
      return fresh.length
    },

    patch(subscriptionId, id, patch) {
      const i = items.findIndex((it) => it.id === id && it.subscriptionId === subscriptionId)
      if (i < 0) return
      const cur = items[i]!
      // 只算**真的变了**的字段:服务端 reading.changed 回显会带全套字段,但标已读/星标
      // 往往没变 —— 不比较的话每次续播都会当成结构化变更,播放中每 5 秒全量重算一次。
      const changed = Object.entries(patch).filter(([k, v]) => (cur as unknown as Record<string, unknown>)[k] !== v)
      if (!changed.length) return
      if (changed.every(([k]) => PROGRESS_FIELDS.has(k))) {
        // 原地写:对象/数组身份不变,不触发 React 重渲染;消费方下次渲染时读到新值。
        // ⚠️ 只有 `progress` 订阅者可以做「等下次渲染」的处理 —— 依赖实时进度的视图
        // （播放页持续显示的上一条进度）不在这个假设里,当前没有这种视图。
        Object.assign(cur, Object.fromEntries(changed))
        emit("progress")
        return
      }
      items = items.map((it) =>
        it.id === id && it.subscriptionId === subscriptionId ? ({ ...it, ...patch } as MediaItem) : it,
      )
      emit("items")
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
      if (items.length !== before) emit("items")
    },
  }
}
