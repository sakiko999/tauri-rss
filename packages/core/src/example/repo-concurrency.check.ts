/**
 * 仓储并发自检 —— 读-改-写必须串行化,否则并发写会互相覆盖。
 *
 * 跑:`bun packages/core/src/example/repo-concurrency.check.ts`
 *
 * 为什么单列一条:这一层坏掉的表现不是报错,而是**静默丢数据**——用户点「全部标为已读」
 * 后只有一条落盘,刷新/重启后整批回到未读;或者两条并发编辑只剩一条。没人会立刻发现。
 *
 * 用「每次 get/set 之间插入一个事件循环让位」的假存储放大交错窗口,复现真实竞态:
 * 不串行化时 N 次并发 patch 全部读到同一份旧 map → 只有最后一次生效。
 */
import assert from "node:assert/strict"
import { createReadingRepository } from "../repo/reading-repo.ts"
import { createSubscriptionRepository } from "../repo/subscription-repo.ts"

/** 内存 KV,set/get 之间强制让出事件循环(放大交错窗口)。 */
function laggyStorage() {
  const map = new Map<string, string>()
  return {
    map,
    async get(key: string) {
      await new Promise((r) => setTimeout(r, 0))
      return map.get(key) ?? null // StorageBackend.get 缺值返回 null,不是 undefined
    },
    async set(key: string, value: string) {
      await new Promise((r) => setTimeout(r, 0))
      map.set(key, value)
    },
    async delete(key: string) {
      map.delete(key)
    },
    async keys(prefix = "") {
      return [...map.keys()].filter((k) => k.startsWith(prefix))
    },
  }
}

// ── reading:并发 markRead 不能互相覆盖 ──────────────────────────────────────
{
  const storage = laggyStorage()
  const reading = createReadingRepository(storage, () => 1)

  // 先写一条基线记录,再并发写 5 条 —— 基线必须活下来(旧实现会被整表覆盖掉)。
  await reading.markRead("base", true)
  await Promise.all(["a", "b", "c", "d", "e"].map((id) => reading.markRead(id, true)))

  const all = await reading.getAll()
  assert.deepEqual(
    Object.keys(all).sort(), // 默认字典序即可,只比集合不比顺序
    ["a", "b", "base", "c", "d", "e"],
    `并发 markRead 丢了记录:${JSON.stringify(Object.keys(all))}`,
  )
  assert.ok(all["base"]!.read, "已有记录被并发写抹掉")
}

// ── reading:批量标记一次落盘 ────────────────────────────────────────────────
{
  const storage = laggyStorage()
  const reading = createReadingRepository(storage, () => 1)
  await reading.markRead("keep-star", false)
  await reading.setStarred("keep-star", true)
  const ids = Array.from({ length: 50 }, (_, i) => `m${i}`)
  await reading.markManyRead(ids, true)

  const all = await reading.getAll()
  assert.equal(Object.keys(all).length, 51, `批量标记丢了记录(应有 51 条,实际 ${Object.keys(all).length})`)
  assert.ok(all["keep-star"]!.starred, "批量标记抹掉了既有星标")
}

// ── subscriptions:并发更新不能互相覆盖 ─────────────────────────────────────
{
  const storage = laggyStorage()
  const now = () => 1
  const repo = createSubscriptionRepository(storage, now)
  await repo.add({ id: "s1", channelKey: "bili:popular", title: "x", enabled: true, info: {}, createdAt: 1, updatedAt: 1 })
  await repo.add({ id: "s2", channelKey: "bili:popular", title: "y", enabled: true, info: {}, createdAt: 1, updatedAt: 1 })

  // 并发改两条不同记录的标题 + 加一个分组:三者都要活下来。
  await Promise.all([
    repo.update("s1", { title: "T1" }),
    repo.update("s2", { title: "T2" }),
    repo.addGroup({ id: "g1", title: "G" }),
  ])

  const subs = await repo.list()
  const groups = await repo.listGroups()
  assert.equal(subs.find((s) => s.id === "s1")?.title, "T1", "并发 update 丢了 s1 的改动")
  assert.equal(subs.find((s) => s.id === "s2")?.title, "T2", "并发 update 丢了 s2 的改动")
  assert.deepEqual(groups.map((g) => g.id), ["g1"], "并发 addGroup 被订阅写入覆盖")
}

// ── subscriptions:update 不允许把 channelKey 改空 ───────────────────────────
{
  const storage = laggyStorage()
  const repo = createSubscriptionRepository(storage, () => 1)
  await repo.add({ id: "s1", channelKey: "bili:popular", title: "x", enabled: true, info: {}, createdAt: 1, updatedAt: 1 })
  const next = await repo.update("s1", { channelKey: "" })
  assert.equal(next?.channelKey, "bili:popular", "channelKey 被改空 —— 该订阅会静默失效")
}

console.log("✔ repo 并发自检通过(reading/subscriptions 读-改-写串行化)")
