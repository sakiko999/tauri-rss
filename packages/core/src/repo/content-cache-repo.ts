/**
 * ContentCacheRepo — 订阅抓取内容缓存持久化,走全局 appHost.storage(KV 抽象)。
 *
 * 形态:每订阅一个 key,value = `JSON.stringify({ fetchedAt, xml })`——缓存「序列化
 * RSS XML 字符串」,命中时复用 deserializeFeedWithTotal 重建 MediaItem(不新增
 * MediaItem 序列化面)。TTL 判定在调用方(data-layer)做——TTL 值可变(settings/
 * 订阅级),不入库硬编码。
 *
 * 选 KV 而非 SQLite content 表:repo 层只认 storage 抽象,加表须破「换 backend 不动
 * repo」;单订阅 XML 几十 KB,KV 值存储胜任。P6 大容量/离线搜索再评估 content 表。
 *
 * StorageBackend 是全局类型(global.d.ts 声明),不 import。
 */
export interface ContentCacheEntry {
  /** 抓取时间戳(epoch ms),TTL 判定基准。 */
  fetchedAt: number
  /** 序列化 RSS XML(deserializeFeedWithTotal 直接消费)。 */
  xml: string
}

export interface ContentCacheRepo {
  /** 读某订阅缓存;损坏/缺失返回 null(调用方视为无缓存)。 */
  get(subscriptionId: string): Promise<ContentCacheEntry | null>
  /** 写某订阅缓存(覆盖)。 */
  set(subscriptionId: string, entry: ContentCacheEntry): Promise<void>
  /** 删某订阅缓存(订阅移除时)。 */
  delete(subscriptionId: string): Promise<void>
}

export function createContentCacheRepo(
  storage: StorageBackend,
  prefix = "content:",
): ContentCacheRepo {
  const key = (subscriptionId: string): string => `${prefix}${subscriptionId}`

  return {
    async get(subscriptionId) {
      const raw = await storage.get(key(subscriptionId))
      if (!raw) return null
      try {
        return JSON.parse(raw) as ContentCacheEntry
      } catch {
        // 缓存损坏 → 视为无缓存(下次抓取覆盖)。
        return null
      }
    },
    async set(subscriptionId, entry) {
      await storage.set(key(subscriptionId), JSON.stringify(entry))
    },
    async delete(subscriptionId) {
      await storage.delete(key(subscriptionId))
    },
  }
}
