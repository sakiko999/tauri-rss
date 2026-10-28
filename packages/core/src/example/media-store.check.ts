/**
 * media-store 查询自检 —— 覆盖 `subscriptionIds`(分组聚合)与既有分支。
 * 跑:`bun packages/core/src/example/media-store.check.ts`
 *
 * 用最小断言(非框架):仓库没有测试基础设施,这里只做「谁的逻辑坏了就先炸」的那一层。
 */

import assert from "node:assert/strict"

import { createMediaStore } from "../store/media-store.ts"
import type { MediaItem } from "../types/media-item.ts"

const NOW = Date.parse("2026-10-11T12:00:00Z")

function item(id: string, subscriptionId: string, extra: Partial<MediaItem> = {}): MediaItem {
  return {
    id,
    subscriptionId,
    kind: "video",
    title: id,
    fetchedAt: NOW,
    ...extra,
  } as MediaItem
}

const store = createMediaStore(() => NOW)
store.replace("s-a", [
  item("a1", "s-a", { publishedAt: NOW - 1000, isUnread: true }),
  item("a2", "s-a", { publishedAt: NOW - 3000, isStarred: true }),
])
store.replace("s-b", [item("b1", "s-b", { publishedAt: NOW - 2000, isUnread: true })])
store.replace("s-c", [item("c1", "s-c", { publishedAt: NOW - 4000 })])

// 单一订阅。
assert.deepEqual(
  store.query({ subscriptionId: "s-a" }).map((i) => i.id),
  ["a1", "a2"],
)

// ⭐ subscriptionIds(分组聚合):组 = {s-a, s-b},不包含 s-c。
assert.deepEqual(
  store.query({ subscriptionIds: ["s-a", "s-b"] }).map((i) => i.id),
  ["a1", "b1", "a2"],
)
assert.deepEqual(
  store.query({ subscriptionIds: [] }).map((i) => i.id),
  [],
  "空数组 = 空组,不是「不过滤」",
)

// subscriptionIds 与其它条件取交集。
assert.deepEqual(
  store.query({ subscriptionIds: ["s-a", "s-b"], unreadOnly: true }).map((i) => i.id),
  ["a1", "b1"],
)
assert.deepEqual(
  store.query({ subscriptionIds: ["s-a", "s-b"], starredOnly: true }).map((i) => i.id),
  ["a2"],
)

// 既有分支不回归。
assert.equal(store.query({ unreadOnly: true }).length, 2)
assert.deepEqual(
  store.query({ starredOnly: true }).map((i) => i.id),
  ["a2"],
)
assert.equal(store.query({ today: true }).length, 4)
assert.equal(store.all().length, 4)

// 排序:publishedAt 降序。
assert.deepEqual(
  store.query().map((i) => i.id),
  ["a1", "b1", "a2", "c1"],
)

// patch 就地合并 + 触发订阅回调。
let emits = 0
store.subscribe(() => emits++)
store.patch("s-a", "a1", { isUnread: false })
assert.equal(store.query({ unreadOnly: true }).length, 1)
assert.equal(emits, 1)
store.patch("s-a", "nope", { isUnread: false })
assert.equal(emits, 1, "不存在的 id 不该触发回调")

// ⭐ patch 必须带 subscriptionId:同一个 id 跨订阅出现时只能改自己那条。
// (实测 bilibili:7734200 同时在 bili:live 与 bili:live:hot。)
store.replace("s-dup", [item("d1", "s-dup", { isUnread: true })])
store.replace("s-other", [item("d1", "s-other", { isUnread: true })])
store.patch("s-dup", "d1", { isUnread: false })
assert.equal(
  store.query({ subscriptionId: "s-other" })[0]?.isUnread,
  true,
  "打 s-dup 的 patch 把 s-other 的同 id 条目也改了 —— 订阅维度丢了",
)
// 订阅对不上 → 不该命中任何条目。
store.patch("s-nope", "d1", { isUnread: false })
assert.equal(store.query({ subscriptionId: "s-dup" })[0]?.isUnread, false, "应是上一步的效果,未被 s-nope 二次改动")

// append 同订阅内按 id 去重。
store.append("s-b", [item("b1", "s-b"), item("b2", "s-b", { publishedAt: NOW })])
assert.deepEqual(
  store.query({ subscriptionId: "s-b" }).map((i) => i.id),
  ["b2", "b1"],
)

// ⭐ append 对同批内部的重复 id 也去重(与 replace 对称;addedCount 只算真实新增)。
store.append("s-append-dup", [
  item("e1", "s-append-dup", { publishedAt: NOW }),
  item("e2", "s-append-dup", { publishedAt: NOW - 1000 }),
  item("e1", "s-append-dup", { publishedAt: NOW - 2000 }), // 同批重复,应被丢弃
])
assert.deepEqual(
  store.query({ subscriptionId: "s-append-dup" }).map((i) => i.id),
  ["e1", "e2"],
)
assert.equal(store.all().filter((i) => i.subscriptionId === "s-append-dup").length, 2)

// ⭐ replace 也按 id 去重(契约:id 在订阅内唯一)。
// 案底:小红书滚动翻页后平台 state 会把同一笔记追加两次,xml 缓存 61 条里 60 唯一,
// UI 报「Encountered two children with the same key」。
store.replace("s-dup2", [
  item("x1", "s-dup2", { publishedAt: NOW }),
  item("x2", "s-dup2", { publishedAt: NOW - 1000 }),
  item("x1", "s-dup2", { publishedAt: NOW - 2000 }),
])
assert.deepEqual(
  store.query({ subscriptionId: "s-dup2" }).map((i) => i.id),
  ["x1", "x2"],
  "replace 未按 id 去重 —— 同一订阅会渲染重复条目",
)

console.log(
  "✔ media-store 查询自检通过(subscriptionIds / unread / starred / today / 排序 / patch / append / replace 去重)",
)
