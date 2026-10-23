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
 */
export function readingKey(subscriptionId: string, itemId: string): string {
  return `${subscriptionId}\u0000${itemId}`
}

/**
 * 视图/队列用的复合键（可读形式，分隔符 `:`）。
 *
 * 与 `readingKey` 分开：readingKey 要可逆、且 itemId 常含 `:`，所以用 `\u0000`；
 * 这个键只用于 React key / 队列元素 / 选中态，不反解，沿用历史 `subId:itemId` 格式。
 * 凡「按 id 记/改/查」的入口都应先经过它，禁止裸 id。
 */
export function itemRefKey(subscriptionId: string, itemId: string): string {
  return `${subscriptionId}:${itemId}`
}

/** 查记录：键必须带订阅维度（见 readingKey）。 */
export function findRecord(
  map: ReadingMap,
  subscriptionId: string,
  itemId: string,
): ReadRecord | undefined {
  return map[readingKey(subscriptionId, itemId)]
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
