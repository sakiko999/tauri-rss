/**
 * memStorage — 内存 StorageBackend(Map)。
 * 供 example / 测试注入(无持久化)。
 */
export function memStorage(): StorageBackend {
  const m = new Map<string, string>()
  return {
    async get(k) {
      return m.get(k) ?? null
    },
    async set(k, v) {
      m.set(k, v)
    },
    async delete(k) {
      m.delete(k)
    },
    async keys(p = "") {
      return [...m.keys()].filter((k) => k.startsWith(p))
    },
    // Map 上的同步循环本身就是原子的（没有 await 让出控制权）。
    async batch(ops) {
      for (const op of ops) {
        if (op.type === "set") m.set(op.key, op.value)
        else m.delete(op.key)
      }
    },
  }
}
