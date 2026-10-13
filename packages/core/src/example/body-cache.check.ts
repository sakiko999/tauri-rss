/**
 * BodyCacheRepo 自检 —— `bun packages/core/src/example/body-cache.check.ts`
 * 覆盖:写读往返 / 索引去重 / 按订阅清空(退订)/ 损坏值容错 / 不同订阅隔离。
 */
import { createBodyCacheRepo } from "../repo/body-cache-repo.ts"

/** 最小内存 StorageBackend(与全局接口同形)。 */
function memStorage(): StorageBackend {
  const m = new Map<string, string>()
  return {
    get: async (k) => m.get(k) ?? null,
    set: async (k, v) => void m.set(k, v),
    delete: async (k) => void m.delete(k),
    keys: async () => [...m.keys()],
  } as StorageBackend
}

let fails = 0
const ok = (c: unknown, label: string) => {
  if (c) console.log(`  ✓ ${label}`)
  else {
    fails++
    console.error(`  ✗ ${label}`)
  }
}

const repo = createBodyCacheRepo(memStorage())

// 写读往返
await repo.set("s1", "item-a", { content: "正文A", contentFormat: "text", fetchedAt: 1 })
const a = await repo.get("s1", "item-a")
ok(a?.content === "正文A" && a?.contentFormat === "text", "写读往返")

// 未命中
ok((await repo.get("s1", "nope")) === null, "未命中返回 null")
ok((await repo.get("s2", "item-a")) === null, "跨订阅隔离(不串)")

// 覆盖写 + 索引不重复膨胀
await repo.set("s1", "item-a", { content: "正文A2", contentFormat: "text", fetchedAt: 2 })
ok((await repo.get("s1", "item-a"))?.content === "正文A2", "覆盖写生效")

// 同订阅多条 + 另一订阅一条
await repo.set("s1", "item-b", { content: "正文B", contentFormat: "text", fetchedAt: 3 })
await repo.set("s2", "item-x", { content: "正文X", contentFormat: "html", fetchedAt: 4 })

// 按订阅清空(退订):s1 全清,s2 保留
await repo.deleteAll("s1")
ok((await repo.get("s1", "item-a")) === null, "deleteAll 清 item-a")
ok((await repo.get("s1", "item-b")) === null, "deleteAll 清 item-b")
ok((await repo.get("s2", "item-x"))?.content === "正文X", "deleteAll 不误伤其他订阅")

// 再写 s1(索引应已重置,能正常重建)
await repo.set("s1", "item-c", { content: "正文C", contentFormat: "text", fetchedAt: 5 })
ok((await repo.get("s1", "item-c"))?.content === "正文C", "清空后可重建索引")

// 并发写同订阅:索引读-改-写必须串行(否则丢索引项 → 退订漏清)
{
  const st = memStorage()
  const r = createBodyCacheRepo(st)
  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      r.set("sc", `item-${i}`, { content: `c${i}`, contentFormat: "text", fetchedAt: i }),
    ),
  )
  await r.deleteAll("sc")
  const left = await r.get("sc", "item-7")
  ok(left === null, "并发写后 deleteAll 全清(索引未丢项)")
  ok((await r.get("sc", "item-19")) === null, "并发写后 deleteAll 清末项")
}

// 损坏值容错
const st = memStorage()
const r2 = createBodyCacheRepo(st)
await st.set("body:s3:bad", "{not json")
ok((await r2.get("s3", "bad")) === null, "损坏值返回 null")

console.log(fails === 0 ? "\n全部通过" : `\n${fails} 项失败`)
process.exit(fails === 0 ? 0 : 1)
