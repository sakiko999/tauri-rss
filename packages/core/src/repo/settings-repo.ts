/**
 * SettingsRepository — app 设置持久化,走全局 appHost.storage。
 * 无存储内容时加载 DEFAULT_SETTINGS。
 */
import { type AppSettings, DEFAULT_SETTINGS, type NetLevel } from "../types/settings.ts"

const STORAGE_KEY = "settings"

export interface SettingsRepository {
  get(): Promise<AppSettings>
  set(patch: Partial<AppSettings>): Promise<AppSettings>
  /**
   * compare-and-set:`expected` 的每个 key 与当前值一致才写入,否则返回 null。
   * 比对与写入在同一个串行临界区内完成 —— 并发 set 不可能插进两者之间
   * (get() 不进串行链,「先 get 比对再 set」防不住 last-write-wins)。
   */
  setIfUnchanged(expected: Partial<AppSettings>, patch: Partial<AppSettings>): Promise<AppSettings | null>
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

  /**
   * 兼容旧持久化:等级曾用字符串 "lx",且 9 = L9(浏览器被动)档。
   * 2026-10-21 起 L9 已移除 —— 「谁发起请求」是渠道属性 `RssChannel.passive`,
   * 做成等级会让该平台看不到任何内容(过度防御)。存量一律归一化为 1:
   * 被动渠道仍按属性走 `fetchPassive`,其余渠道恢复普通主动抓取。
   */
  function normalizeLevels(s: AppSettings): AppSettings {
    const legacy = (v: unknown) => v === "lx" || Number(v) === 9
    if (legacy(s.netLevel as unknown)) s.netLevel = 1
    const raw = s.netLevels as unknown
    if (!raw || typeof raw !== "object") {
      s.netLevels = {}
      return s
    }
    const fixed: Record<string, NetLevel> = {}
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      fixed[k] = (legacy(v) ? 1 : v) as NetLevel
    }
    s.netLevels = fixed
    return s
  }

  async function load(): Promise<AppSettings> {
    const raw = await storage.get(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    try {
      return normalizeLevels({ ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) })
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
    async setIfUnchanged(expected, patch) {
      return run(async () => {
        const cur = await load()
        for (const k of Object.keys(expected) as Array<keyof AppSettings>) {
          if (cur[k] !== expected[k]) return null
        }
        const next: AppSettings = { ...cur, ...patch }
        await storage.set(STORAGE_KEY, JSON.stringify(next))
        return next
      })
    },
    async reset() {
      // ⚠️ 走 run() 串行链:裸 storage.set 会与并发的 set()(扫码落 cookie / 保存凭证)
      // 交错 —— 后写者用旧快照覆盖 → reset 丢失或刚写入的 cookie 被默认值抹掉。
      return run(async () => {
        await storage.set(STORAGE_KEY, JSON.stringify(DEFAULT_SETTINGS))
        return { ...DEFAULT_SETTINGS }
      })
    },
  }
}
