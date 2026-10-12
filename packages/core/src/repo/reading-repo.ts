/**
 * ReadingRepository — 阅读状态(read/续播/滚动)持久化,走全局 appHost.storage。
 */
import type { ReadRecord, ReadingMap } from "../types/reading.ts"

const STORAGE_KEY = "reading"

export interface ReadingRepository {
  getAll(): Promise<ReadingMap>
  get(itemId: string): Promise<ReadRecord | undefined>
  markRead(itemId: string, read?: boolean): Promise<void>
  setStarred(itemId: string, starred: boolean): Promise<void>
  setPosition(itemId: string, positionSec: number): Promise<void>
  setScrollRatio(itemId: string, scrollRatio: number): Promise<void>
  /** 批量标已读:一次读改写落盘。逐条 markRead 并发会互相覆盖(见 serial 注释)。 */
  markManyRead(itemIds: string[], read?: boolean): Promise<void>
}

export function createReadingRepository(storage: StorageBackend, now: () => number): ReadingRepository {
  /**
   * 读-改-写串行化。整张 map 存在一个 KV blob 里,`load → 改 → save` 三步之间只要
   * 有一次并发就会互相覆盖(后写者用的是它读到的旧快照,前写者的改动凭空消失)。
   *
   * 触发场景真实存在:desktop `markAllRead` 用 `void` 循环发 N 条 markRead(不 await),
   * 全部读到同一份旧 map,最终只有一条落盘,**且整张表被最后一人的快照覆盖** ——
   * 历史已读/星标全丢。串行化后每条都在前一条的结果上叠加。
   */
  let serial: Promise<unknown> = Promise.resolve()
  function run<T>(fn: () => Promise<T>): Promise<T> {
    const next = serial.then(fn, fn)
    serial = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  async function load(): Promise<ReadingMap> {
    const raw = await storage.get(STORAGE_KEY)
    if (!raw) return {}
    try {
      const parsed: unknown = JSON.parse(raw)
      // 非对象(数组/null/标量)当损坏处理,不走 as 断言把坏结构当 map 用。
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
      return parsed as ReadingMap
    } catch {
      // ⚠️ 解析失败**不能静默返回 {}**:调用方随后就会 save(),把这份空表写回去 ——
      // 一次坏值(半截写/外部改坏)会让全部已读与星标永久消失。这里先把它挪到
      // `reading:corrupt` 留证,再让调用方当作「无记录」继续(不清空任何东西)。
      try {
        await storage.set(`${STORAGE_KEY}:corrupt`, raw)
        await storage.delete(STORAGE_KEY)
      } catch {
        /* 留存失败也只能继续,不能在加载路径上抛。 */
      }
      return {}
    }
  }

  async function save(map: ReadingMap): Promise<void> {
    await storage.set(STORAGE_KEY, JSON.stringify(map))
  }

  async function patch(itemId: string, patch: Partial<ReadRecord>): Promise<void> {
    return run(() => patchMany([itemId], patch))
  }

  /** 读一次 map,改完所有 id,再写一次(必须整体在 run() 的临界区内)。 */
  async function patchMany(itemIds: string[], patch: Partial<ReadRecord>): Promise<void> {
    const map = await load()
    const t = now()
    for (const itemId of itemIds) {
      const prev = map[itemId]
      map[itemId] = {
        ...prev,
        read: prev?.read ?? false,
        ...patch,
        lastReadAt: t,
      }
    }
    await save(map)
  }

  return {
    async getAll() {
      return load()
    },
    async get(itemId) {
      return (await load())[itemId]
    },
    async markRead(itemId, read = true) {
      await patch(itemId, { read })
    },
    async setStarred(itemId, starred) {
      await patch(itemId, { starred })
    },
    async setPosition(itemId, positionSec) {
      await patch(itemId, { positionSec })
    },
    async setScrollRatio(itemId, scrollRatio) {
      await patch(itemId, { scrollRatio })
    },
    async markManyRead(itemIds, read = true) {
      if (!itemIds.length) return
      await run(() => patchMany(itemIds, { read }))
    },
  }
}
