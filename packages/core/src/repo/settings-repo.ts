/**
 * SettingsRepository — app 设置持久化,走全局 appHost.storage。
 * 无存储内容时加载 DEFAULT_SETTINGS。
 */
import { DEFAULT_SETTINGS, type AppSettings } from "../types/settings.ts"

const STORAGE_KEY = "settings"

export interface SettingsRepository {
  get(): Promise<AppSettings>
  set(patch: Partial<AppSettings>): Promise<AppSettings>
  reset(): Promise<AppSettings>
}

export function createSettingsRepository(storage: StorageBackend): SettingsRepository {
  async function load(): Promise<AppSettings> {
    const raw = await storage.get(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    try {
      return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) }
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }

  return {
    async get() {
      return load()
    },
    async set(patch) {
      const next: AppSettings = { ...(await load()), ...patch }
      await storage.set(STORAGE_KEY, JSON.stringify(next))
      return next
    },
    async reset() {
      await storage.set(STORAGE_KEY, JSON.stringify(DEFAULT_SETTINGS))
      return { ...DEFAULT_SETTINGS }
    },
  }
}
