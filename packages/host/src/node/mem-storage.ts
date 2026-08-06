/**
 * memStorage — 内存 StorageBackend(Map)。
 * 供 example / 测试注入(无持久化)。
 */
export function memStorage(): StorageBackend {
  const m = new Map<string, string>()
  return {
    async get(k) { return m.get(k) ?? null },
    async set(k, v) { m.set(k, v) },
    async delete(k) { m.delete(k) },
    async keys(p = "") { return [...m.keys()].filter((k) => k.startsWith(p)) },
  }
}
