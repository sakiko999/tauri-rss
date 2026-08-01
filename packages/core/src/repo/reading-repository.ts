/**
 * ReadingRepository — persists the read/position state map (`ReadingMap`) via
 * the host's storage backend. One record per item id.
 */
import type { PlatformHost } from "../types/platform.ts"
import type { ReadRecord, ReadingMap } from "../types/reading.ts"

const STORAGE_KEY = "reading"

export interface ReadingRepository {
  getAll(): Promise<ReadingMap>
  get(itemId: string): Promise<ReadRecord | undefined>
  markRead(itemId: string, read?: boolean): Promise<void>
  setPosition(itemId: string, positionSec: number): Promise<void>
  setScrollRatio(itemId: string, scrollRatio: number): Promise<void>
}

export function createReadingRepository(host: PlatformHost): ReadingRepository {
  async function load(): Promise<ReadingMap> {
    const raw = await host.storage.get(STORAGE_KEY)
    if (!raw) return {}
    try {
      return JSON.parse(raw) as ReadingMap
    } catch {
      return {}
    }
  }

  async function save(map: ReadingMap): Promise<void> {
    await host.storage.set(STORAGE_KEY, JSON.stringify(map))
  }

  async function patch(itemId: string, patch: Partial<ReadRecord>): Promise<void> {
    const map = await load()
    const prev = map[itemId]
    map[itemId] = {
      ...prev,
      read: prev?.read ?? false,
      ...patch,
      lastReadAt: host.now(),
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
    async setPosition(itemId, positionSec) {
      await patch(itemId, { positionSec })
    },
    async setScrollRatio(itemId, scrollRatio) {
      await patch(itemId, { scrollRatio })
    },
  }
}
