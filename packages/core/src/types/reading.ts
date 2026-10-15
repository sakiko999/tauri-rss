/**
 * Reading state — user-local read progress + playback position, persisted
 * via a `ReadingRepository` (zustand persist in the app layer).
 */
export interface ReadRecord {
  read: boolean
  /**
   * 星标。⚠️ 必须有持久层:条目在 refresh 时整批重建(deserialize 默认
   * isStarred=false),只 patch 内存 store 的话重启/刷新后星标就丢了。
   */
  starred?: boolean
  /** 音视频续播位置（秒） */
  positionSec?: number
  /** 文章滚动位置（0..1） */
  scrollRatio?: number
  lastReadAt: number
}

export type ReadingMap = Record<string, ReadRecord>

/**
 * 阅读态的存储键 —— **必须带订阅维度**。
 *
 * `MediaItem.id` 只在**订阅内**唯一（直播房号 / RSS guid），但同一个 id 会被多个订阅
 * 命中：实测 `bilibili:7734200` 同时出现在 `bili:live`(roomIds=6 解析成该房) 与
 * `bili:live:hot`。只按裸 id 落库的话，两处会**共享同一条已读/星标/续播** ——
 * 在热门榜标已读，手填订阅里那条也变已读；续播位置互相覆盖。
 *
 * 分隔符用 `\u0000` 而非 `:` —— itemId 本身常含冒号（`bilibili:6`），用它会让
 * 键不可无歧义解析（虽然当前只作查找用、不反解，仍不留坑）。
 *
 * `subscriptionId` 为空时退化为裸 id（迁移期/无订阅上下文的调用方）。
 */
export function readingKey(subscriptionId: string | undefined, itemId: string): string {
  return subscriptionId ? `${subscriptionId}\u0000${itemId}` : itemId
}

/**
 * 查记录：优先复合键，**回退旧版裸 id**。
 *
 * 2026-10-15 之前的 reading 表按裸 id 存（`{"item-x": {...}}`）。直接改键会让所有
 * 历史已读/星标/续播**一次性消失**，故读取侧保留裸 id 回退。
 *
 * ⚠️ **回退命中时不要把旧键删掉升级**：同一条旧记录可能被**多个订阅**共享
 * （正是本键要解决的问题），删了别的订阅就读不到了。让它自然老化 ——
 * 每个订阅第一次写入自己的复合键后，该订阅就只认复合键了。
 */
export function findRecord(
  map: ReadingMap,
  subscriptionId: string | undefined,
  itemId: string,
): ReadRecord | undefined {
  return map[readingKey(subscriptionId, itemId)] ?? map[itemId]
}

/**
 * 从条目列表里按 **(订阅, id)** 定位一条。
 *
 * ⚠️ 不能只比 `id` —— 同一个 id 会跨订阅出现（`bili:live` 与 `bili:live:hot` 都有
 * `bilibili:7734200`），只比 id 会拿到**另一个订阅**那条，读它的 `positionSec` /
 * `scrollRatio` 去判节流与清除，判据全错。
 */
export function findItem<T extends { id: string; subscriptionId: string }>(
  items: readonly T[],
  subscriptionId: string | undefined,
  itemId: string,
): T | undefined {
  return items.find((it) => it.id === itemId && it.subscriptionId === subscriptionId)
}
