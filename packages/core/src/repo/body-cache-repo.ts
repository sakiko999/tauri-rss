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

  /**
   * ⚠️ 索引是**读-改-写**,必须串行化:并发 set(如一次 refresh 后多篇续点开)会各自
   * 读到同一旧索引、后写者覆盖,丢掉先写者刚加的 itemId → 退订时那条 KV **永不清理**
   * (泄漏)。按订阅分组的串行链(与 reading-repo 同款;不同订阅互不阻塞)。
   */
  const serial = new Map<string, Promise<unknown>>()
  function serialize<T>(subscriptionId: string, fn: () => Promise<T>): Promise<T> {
    const prev = serial.get(subscriptionId) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    serial.set(
      subscriptionId,
      next.then(
        () => {},
        () => {},
      ),
    )
    return next
  }

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
      // 值写入无需串行(不同 key);仅索引读-改-写串行。但两者放同一条链更简单且无副作用。
      return serialize(subscriptionId, async () => {
        await storage.set(key(subscriptionId, itemId), JSON.stringify(entry))
        const idx = await readIndex(subscriptionId)
        if (!idx.includes(itemId)) {
          idx.push(itemId)
          await storage.set(indexKey(subscriptionId), JSON.stringify(idx))
        }
      })
    },
    async deleteAll(subscriptionId) {
      return serialize(subscriptionId, async () => {
        const idx = await readIndex(subscriptionId)
        await Promise.all(idx.map((id) => storage.delete(key(subscriptionId, id))))
        await storage.delete(indexKey(subscriptionId))
      })
    },
  }
}
