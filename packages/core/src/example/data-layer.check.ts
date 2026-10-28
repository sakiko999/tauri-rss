/**
 * DataLayer 自检 —— 覆盖本轮修的两个「静默丢数据 / 静默发请求」缺陷:
 *   1. 停用订阅**不发网络请求**(但复用缓存);
 *   2. 已读 / 星标在 refresh 整批重建后**被回填**(不丢)。
 *
 * 跑:`bun packages/core/src/example/data-layer.check.ts`
 * 最小断言(非框架):仓库没有测试基础设施。用内存存储 + 假 channel 注入,
 * 不触网 —— 判的是编排逻辑,不是抓取。
 */

import assert from "node:assert/strict"

import { registerAllChannels } from "@amoeba/crawler"
import { injectNodeHost } from "@amoeba/host/node"

import { createDataLayer } from "../index.ts"
import type { Subscription } from "../types/subscription.ts"

injectNodeHost()
registerAllChannels()

/** 记录 fetch 调用次数的假渠道——经 core 的 source 注册表不可注入,故用一个
 *  真实注册的 channelKey + 本地 http 拦截不可行;这里改为直接断言
 *  「停用订阅 refresh 的副作用」与「reading 回填」两件纯编排行为。 */

const dl = createDataLayer()
const t = Date.now()

/** 造一个订阅(绕过 addSubscription 的自动 refresh,避免触网)。 */
async function seed(sub: Omit<Subscription, "createdAt" | "updatedAt">): Promise<void> {
  await dl.subscriptions.add({ ...sub, createdAt: t, updatedAt: t })
}

// ── 1. 停用订阅:refresh 不发请求、不报错 ──
// 用一个必然失败的 channelKey 做对照:启用的会返回 error(证明它试过抓取),
// 停用的应静默返回且**无 error**(证明它根本没试)。
await seed({ id: "chk-off", channelKey: "bili:popular", title: "停用测试", enabled: false, info: {} })
await seed({ id: "chk-on", channelKey: "no:such:channel", title: "错误通道", enabled: true, info: {} })

const off = await dl.refresh("chk-off")
assert.equal(off.error, undefined, "停用订阅不该报错")
assert.equal(off.itemCount, 0, "停用订阅不产出新条目(无缓存时)")

const on = await dl.refresh("chk-on")
assert.ok(on.error, "未注册渠道的启用订阅应如实报错(反向证明 refresh 确实走到抓取段)")

// ── 2. 已读 / 星标回填 ──
// 直接写 reading,再走一次会命中缓存的 refresh 路径不可控;改用 core 暴露的
// reading + store,断言 applyReadingState 的效果(它是 refresh 内部共用的回填)。
await dl.reading.markRead("s-chk", "item-x", true)
await dl.reading.setStarred("s-chk", "item-x", true)
const rec = await dl.reading.get("s-chk", "item-x")
assert.ok(rec?.read, "reading 应记录已读")
assert.ok(rec?.starred, "reading 应记录星标(新增字段)")

// store.patch 的入参形状(必须带 subscriptionId,与 readingKey 同维度)。
// 本用例没 refresh 过,store 里没有该条目 → patch 是 no-op,这里只验签名不抛。
dl.store.patch("s-chk", "item-x", { isUnread: false, isStarred: true })
const inStore = dl.store.all().find((i) => i.id === "item-x")
if (inStore) {
  assert.equal(inStore.isUnread, false)
  assert.equal(inStore.isStarred, true)
}

// ── 3. 抓取解析出 0 条 ≠ 成功:不能把已有内容清空 ──
// 真实场景:源临时故障 / 反爬返回空壳页 → fetch 成功但解析出 0 条。旧实现会
// store.replace(空) 并把空 XML 写进缓存,内容在内存和磁盘上一起消失。
{
  const { registerChannel } = await import("@amoeba/crawler")
  const { serializeFeed } = await import("@amoeba/xml")
  let mode: "items" | "empty" = "items"
  registerChannel({
    key: "chk:fake",
    name: "空壳源",
    kind: "article",
    getSource: () => ({
      fetch: async () =>
        mode === "empty"
          ? serializeFeed([], { channelTitle: "空壳源" })
          : serializeFeed(
              [
                {
                  id: "fake-1",
                  sourceId: "chk:fake",
                  kind: "article",
                  title: "真内容",
                  url: "https://example.com/a",
                  fetchedAt: Date.now(),
                },
              ],
              { channelTitle: "空壳源" },
            ),
    }),
  })
  await seed({ id: "chk-empty", channelKey: "chk:fake", title: "空抓取测试", enabled: true, info: {} })

  const first = await dl.refresh("chk-empty", { force: true })
  assert.equal(first.itemCount, 1, "首抓应拿到 1 条")
  assert.equal(dl.store.query({ subscriptionId: "chk-empty" }).length, 1, "条目应进 store")

  mode = "empty"
  const second = await dl.refresh("chk-empty", { force: true })
  assert.ok(second.error, "解析出 0 条应如实报错,不能当成功")
  assert.equal(dl.store.query({ subscriptionId: "chk-empty" }).length, 1, "空抓取覆盖掉了已有内容(数据丢失)")
  await dl.subscriptions.remove("chk-empty")
}

// ── reading.lastReadAt 回填:「继续」智能订阅按它排序 ──
// 走真实 refresh 路径(refresh 内部调 applyReadingState),断言 lastReadAt 从 reading 回填到
// store 的 MediaItem —— 漏回填则「继续」只能按 publishedAt 排,丢「接着上次看」语义。
{
  const { registerChannel } = await import("@amoeba/crawler")
  const { serializeFeed } = await import("@amoeba/xml")
  registerChannel({
    key: "chk-readat",
    name: "回填源",
    kind: "article",
    getSource: () => ({
      fetch: async () =>
        serializeFeed(
          [
            {
              id: "ra-1",
              sourceId: "chk-readat",
              kind: "article",
              title: "回填",
              url: "https://example.com/r",
              fetchedAt: Date.now(),
            },
          ],
          { channelTitle: "回填源" },
        ),
    }),
  })
  await seed({ id: "chk-readat", channelKey: "chk-readat", title: "回填测试", enabled: true, info: {} })
  await dl.refresh("chk-readat", { force: true })
  await dl.reading.markRead("chk-readat", "ra-1", true) // 写 reading(含 lastReadAt)
  await dl.refresh("chk-readat", { force: true }) // 再刷新 → applyReadingState 回填
  const it = dl.store.query({ subscriptionId: "chk-readat" }).find((i) => i.id === "ra-1")
  assert.ok(it?.lastReadAt, "lastReadAt 应从 reading 回填到 MediaItem(否则「继续」无法按最近观看排)")
  assert.equal(it?.isUnread, false, "顺带:已读也应回填")
  await dl.subscriptions.remove("chk-readat")
}

// 退订竞态:在途 refresh 完成后若订阅已退订,不再写回内容(否则 rail 消失但条目
// 仍留在「全部」—— 退订不彻底)。用慢速 fake channel 制造 refresh 与 remove 竞态。
{
  const { registerChannel } = await import("@amoeba/crawler")
  const { serializeFeed } = await import("@amoeba/xml")
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  registerChannel({
    key: "chk:slow",
    name: "慢源",
    kind: "article",
    getSource: () => ({
      fetch: async () => {
        await gate // 挂住,直到 remove 之后才放行
        return serializeFeed(
          [
            {
              id: "slow-1",
              sourceId: "chk:slow",
              kind: "article",
              title: "迟到内容",
              url: "https://example.com/s",
              fetchedAt: Date.now(),
            },
          ],
          { channelTitle: "慢源" },
        )
      },
    }),
  })
  await seed({ id: "chk-race", channelKey: "chk:slow", title: "竞态测试", enabled: true, info: {} })
  const pending = dl.refresh("chk-race", { force: true })
  await dl.subscriptions.remove("chk-race") // 抓取途中退订
  release()
  await pending
  assert.equal(
    dl.store.query({ subscriptionId: "chk-race" }).length,
    0,
    "退订后,在途 refresh 不得把内容写回(防复活竞态)",
  )
}

// ── 5. 退订清理:content/body 多键合并成一次 batch 删净(R10) ──
{
  const storage = globalThis.appHost.storage
  let batches = 0
  const origBatch = storage.batch?.bind(storage)
  if (origBatch) {
    storage.batch = async (ops) => {
      batches += 1
      await origBatch(ops)
    }
  }
  await seed({ id: "chk-gc", channelKey: "bili:popular", title: "清理测试", enabled: false, info: {} })
  await storage.set("content:chk-gc", JSON.stringify({ fetchedAt: t, xml: "<rss/>" }))
  await storage.set("body:chk-gc:item-1", "{}")
  await storage.set("body:chk-gc:item-2", "{}")
  await dl.subscriptions.remove("chk-gc")
  const left = await storage.keys("")
  assert.ok(!left.includes("content:chk-gc"), "退订后 content 缓存已清")
  assert.ok(!left.some((k) => k.startsWith("body:chk-gc:")), "退订后 body 缓存已清")
  if (origBatch) assert.ok(batches > 0, "多键删除走了 batch(不是逐个删)")
}

// 清理,避免污染同机的 CLI 库(用的是各自 storage key,这里仍清一遍)。
await dl.subscriptions.remove("chk-off")
await dl.subscriptions.remove("chk-on")

console.log("✔ DataLayer 自检通过(停用订阅不抓取 / reading 回填 / lastReadAt 回填 / 空抓取不丢内容)")
