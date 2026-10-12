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
  /**
   * 读-改-写串行化。settings 里含 cookie / rsshubBaseUrl,后端好几个地方会并发
   * `set`(扫码登录落 cookie、保存凭证、外观开关),不串行化就会互相覆盖。
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

  async function load(): Promise<AppSettings> {
    const raw = await storage.get(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    try {
      return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) }
    } catch {
      // ⚠️ 解析失败静默回默认值 = 下一次 set() 把默认值写回,用户设置(cookie /
      // rsshubBaseUrl / 刷新间隔)全部静默还原。先留证再回默认值。
      try {
        await storage.set(`${STORAGE_KEY}:corrupt`, raw)
        await storage.delete(STORAGE_KEY)
      } catch {
        /* 留存失败也继续。 */
      }
      return { ...DEFAULT_SETTINGS }
    }
  }

  return {
    async get() {
      return load()
    },
    async set(patch) {
      return run(async () => {
        const next: AppSettings = { ...(await load()), ...patch }
        await storage.set(STORAGE_KEY, JSON.stringify(next))
        return next
      })
    },
    async reset() {
      await storage.set(STORAGE_KEY, JSON.stringify(DEFAULT_SETTINGS))
      return { ...DEFAULT_SETTINGS }
    },
  }
}
