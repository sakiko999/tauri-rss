/**
 * BodyCacheRepo — 文章补全正文的持久缓存(KV 抽象,走 appHost.storage)。
 *
 * 形态:每条一个 key,value = `JSON.stringify({ content, contentFormat, fetchedAt })`。
 * 与 ContentCacheRepo(订阅级 XML 缓存)同款思路,但粒度是**单条目正文**——通用 RSS
 * 只带摘要时,点开抓原文页提的正文在此持久化,重开应用不必重抓(且抓不到的源不反复打)。
 *
 * 无 TTL:文章正文是静态的,除非订阅退订(delete)否则长存。若将来需要「原文更新后刷新」,
 * 在此加 fetchedAt 判过期。StorageBackend 是全局类型(global.d.ts),不 import。
 */
export interface BodyCacheEntry {
  /** 提取的正文纯文本。 */
  content: string
  /** 正文格式(通用 RSS 提取恒为 "text";xhs 详情可能是 html)。 */
  contentFormat: "html" | "markdown" | "text"
  /** 提取时间戳(epoch ms)。 */
  fetchedAt: number
}

export interface BodyCacheRepo {
  /** 读某条目正文缓存;损坏/缺失返回 null。 */
  get(subscriptionId: string, itemId: string): Promise<BodyCacheEntry | null>
  /** 写某条目正文缓存(覆盖)。 */
  set(subscriptionId: string, itemId: string, entry: BodyCacheEntry): Promise<void>
  /** 删某订阅的全部条目正文缓存(订阅退订时;条目 id 未知,按前缀清)。 */
  deleteAll(subscriptionId: string): Promise<void>
}

export function createBodyCacheRepo(storage: StorageBackend, prefix = "body:"): BodyCacheRepo {
  // 订阅退订时按前缀清:itemId 未知,故记一份「该订阅已缓存过哪些 item」的索引。
  const indexKey = (subscriptionId: string): string => `${prefix}idx:${subscriptionId}`
  const key = (subscriptionId: string, itemId: string): string => `${prefix}${subscriptionId}:${itemId}`

  async function readIndex(subscriptionId: string): Promise<string[]> {
    const raw = await storage.get(indexKey(subscriptionId))
    if (!raw) return []
    try {
      const arr = JSON.parse(raw) as unknown
      return Array.isArray(arr) ? (arr as string[]) : []
    } catch {
      return []
    }
  }

  return {
    async get(subscriptionId, itemId) {
      const raw = await storage.get(key(subscriptionId, itemId))
      if (!raw) return null
      try {
        return JSON.parse(raw) as BodyCacheEntry
      } catch {
        return null
      }
    },
    async set(subscriptionId, itemId, entry) {
      await storage.set(key(subscriptionId, itemId), JSON.stringify(entry))
      const idx = await readIndex(subscriptionId)
      if (!idx.includes(itemId)) {
        idx.push(itemId)
        await storage.set(indexKey(subscriptionId), JSON.stringify(idx))
      }
    },
    async deleteAll(subscriptionId) {
      const idx = await readIndex(subscriptionId)
      await Promise.all(idx.map((id) => storage.delete(key(subscriptionId, id))))
      await storage.delete(indexKey(subscriptionId))
    },
  }
}
