/**
 * SettingsRepository — persists the app settings (`AppSettings`) via the host's
 * storage backend. Loads `DEFAULT_SETTINGS` when nothing is stored yet.
 */
import type { PlatformHost } from "../types/platform.ts"
import { DEFAULT_SETTINGS, type AppSettings } from "../types/settings.ts"

const STORAGE_KEY = "settings"

export interface SettingsRepository {
  get(): Promise<AppSettings>
  set(patch: Partial<AppSettings>): Promise<AppSettings>
  reset(): Promise<AppSettings>
}

export function createSettingsRepository(host: PlatformHost): SettingsRepository {
  async function load(): Promise<AppSettings> {
    const raw = await host.storage.get(STORAGE_KEY)
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
      await host.storage.set(STORAGE_KEY, JSON.stringify(next))
      return next
    },
    async reset() {
      await host.storage.set(STORAGE_KEY, JSON.stringify(DEFAULT_SETTINGS))
      return { ...DEFAULT_SETTINGS }
    },
  }
}
