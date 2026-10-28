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
  await reading.markRead("s1", "base", true)
  await Promise.all(["a", "b", "c", "d", "e"].map((id) => reading.markRead("s1", id, true)))

  const all = await reading.getAll()
  assert.deepEqual(
    Object.keys(all).sort(), // 默认字典序即可,只比集合不比顺序
    ["s1\u0000a", "s1\u0000b", "s1\u0000base", "s1\u0000c", "s1\u0000d", "s1\u0000e"],
    `并发 markRead 丢了记录:${JSON.stringify(Object.keys(all))}`,
  )
  assert.ok(all["s1\u0000base"]!.read, "已有记录被并发写抹掉")
}

// ── reading:同一 item.id 跨订阅必须互不干扰(复合键的意义)────────────────────
{
  const storage = laggyStorage()
  const reading = createReadingRepository(storage, () => 1)
  // 「手填订阅」与「热门榜」命中同一个房间 —— 实测 bilibili:7734200 就是这样。
  await reading.markRead("s-hand", "bilibili:7734200", true)
  await reading.setPosition("s-hot", "bilibili:7734200", 123)

  const hand = await reading.get("s-hand", "bilibili:7734200")
  const hot = await reading.get("s-hot", "bilibili:7734200")
  assert.equal(hand?.read, true, "手填订阅的已读没落上")
  // ⚠️ 判据是「**不是 true**」而非 undefined:setPosition 也会建记录,
  // 而 patchMany 显式写 `read: prev?.read ?? false`,所以未读过是 false。
  assert.notEqual(hot?.read, true, "热门榜那条被连带标成了已读 —— 说明键没带订阅维度")
  assert.equal(hot?.positionSec, 123, "热门榜的续播位置没落上")
  assert.equal(hand?.positionSec, undefined, "手填那条被写进了热门榜的续播位置 —— 两处串号")
}

// ── reading:批量标记一次落盘 ────────────────────────────────────────────────
{
  const storage = laggyStorage()
  const reading = createReadingRepository(storage, () => 1)
  await reading.markRead("s1", "keep-star", false)
  await reading.setStarred("s1", "keep-star", true)
  // markManyRead 收的是**已拼好的 key**(调用方按 readingKey 拼)。
  const keys = Array.from({ length: 50 }, (_, i) => `s1\u0000m${i}`)
  await reading.markManyRead(keys, true)

  const all = await reading.getAll()
  assert.equal(Object.keys(all).length, 51, `批量标记丢了记录(应有 51 条,实际 ${Object.keys(all).length})`)
  assert.ok(all["s1\u0000keep-star"]!.starred, "批量标记抹掉了既有星标")
}

// ── subscriptions:并发更新不能互相覆盖 ─────────────────────────────────────
{
  const storage = laggyStorage()
  const now = () => 1
  const repo = createSubscriptionRepository(storage, now)
  await repo.add({
    id: "s1",
    channelKey: "bili:popular",
    title: "x",
    enabled: true,
    info: {},
    createdAt: 1,
    updatedAt: 1,
  })
  await repo.add({
    id: "s2",
    channelKey: "bili:popular",
    title: "y",
    enabled: true,
    info: {},
    createdAt: 1,
    updatedAt: 1,
  })

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
  assert.deepEqual(
    groups.map((g) => g.id),
    ["g1"],
    "并发 addGroup 被订阅写入覆盖",
  )
}

// ── subscriptions:update 不允许把 channelKey 改空 ───────────────────────────
{
  const storage = laggyStorage()
  const repo = createSubscriptionRepository(storage, () => 1)
  await repo.add({
    id: "s1",
    channelKey: "bili:popular",
    title: "x",
    enabled: true,
    info: {},
    createdAt: 1,
    updatedAt: 1,
  })
  const next = await repo.update("s1", { channelKey: "" })
  assert.equal(next?.channelKey, "bili:popular", "channelKey 被改空 —— 该订阅会静默失效")
}

// ── subscriptions:addGroup 按 id 去重(重复 add 不留孤儿分组)────────────────
{
  const storage = laggyStorage()
  const repo = createSubscriptionRepository(storage, () => 1)
  await repo.addGroup({ id: "g1", title: "旧名" })
  await repo.addGroup({ id: "g1", title: "新名" }) // 同 id 重复
  const groups = await repo.listGroups()
  assert.equal(groups.filter((g) => g.id === "g1").length, 1, "addGroup 未去重 —— 留下两条同 id 分组")
  assert.equal(groups.find((g) => g.id === "g1")?.title, "新名", "addGroup 未原地覆盖(改名失效)")
}

console.log("✔ repo 并发自检通过(reading/subscriptions 读-改-写串行化)")
