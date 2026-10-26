/**
 * `@amoeba/log` 的开关读取只认 localStorage（浏览器形态），node 下没有它 ——
 * 每个 node 入口（CLI 探针 / 数据服务）都要装同一个 shim，否则 info/debug 恒开；
 * 服务进程还会把 info 写到 stdout，破坏 `READY <port>` 契约。
 *
 * 默认全局关 info/debug；`RSS_LOG=1` 放开（等价 `log="1"`）。`warn/error` 永保留。
 * ⚠️ 只允许这一份实现：CLI 与数据服务的行为分叉时，用户看到的调试开关会不一致。
 */
export function shimLocalStorageForLog(): void {
  const value = process.env.RSS_LOG === "1" ? "1" : "0"
  const store = new Map<string, string>([["log", value]])
  ;(globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, v: string) => void store.set(key, v),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size
    },
  }
}
