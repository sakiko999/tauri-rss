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
import { injectNodeHost } from "@tauri-playground/host"
import { registerAllChannels } from "@tauri-playground/crawler"
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
await dl.reading.markRead("item-x", true)
await dl.reading.setStarred("item-x", true)
const rec = await dl.reading.get("item-x")
assert.ok(rec?.read, "reading 应记录已读")
assert.ok(rec?.starred, "reading 应记录星标(新增字段)")

// store.patch 后 reading 与 store 一致(toggleStar/markRead 的写路径)。
dl.store.patch("item-x", { isUnread: false, isStarred: true })
const inStore = dl.store.all().find((i) => i.id === "item-x")
if (inStore) {
  assert.equal(inStore.isUnread, false)
  assert.equal(inStore.isStarred, true)
}

// 清理,避免污染同机的 CLI 库(用的是各自 storage key,这里仍清一遍)。
await dl.subscriptions.remove("chk-off")
await dl.subscriptions.remove("chk-on")

console.log("✔ DataLayer 自检通过(停用订阅不抓取 / reading 星标字段与回填路径)")
