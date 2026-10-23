/**
 * 错误分类回归 —— `bun packages/core/src/example/error-kind.check.ts`
 *
 * 锁住两件事：
 *   1. `RefreshResult.errorKind` 由 core 从错误对象提取（显式 ResolveError 与普通 Error 都覆盖）；
 *   2. `errorKindOf` 的关键边界：403 不再当成「需要登录」，冷却/429 是 rate-limit。
 *
 * 用内存宿主 + 假渠道，不触网。
 */
import assert from "node:assert/strict"
import { injectNodeHost } from "@amoeba/host/node"
import { registerAllChannels, registerChannel } from "@amoeba/crawler"
import { ERROR_KIND_LABEL, ResolveError, errorKindOf } from "../index.ts"
import { createDataLayer } from "../index.ts"
import type { Subscription } from "../types/subscription.ts"

injectNodeHost()
registerAllChannels()

const t = Date.now()

registerChannel({
  key: "chk:auth",
  name: "显式需要登录",
  kind: "article",
  getSource: () => ({
    fetch: async () => {
      throw new ResolveError("auth", "需要登录后才能访问")
    },
  }),
})

registerChannel({
  key: "chk:plain",
  name: "普通错误",
  kind: "article",
  getSource: () => ({
    fetch: async () => {
      throw new Error("403 Forbidden: copyright restricted")
    },
  }),
})

const dl = createDataLayer()
async function seed(id: string, channelKey: string): Promise<void> {
  const sub: Subscription = { id, channelKey, title: id, enabled: true, info: {}, createdAt: t, updatedAt: t }
  await dl.subscriptions.add(sub)
}

// 显式分类原样透出。
{
  await seed("s-auth", "chk:auth")
  const r = await dl.refresh("s-auth", { force: true })
  assert.equal(r.errorKind, "auth")
  assert.equal(ERROR_KIND_LABEL.auth, "需要登录")
}

// 普通 403 归为 risk，不再误判成 auth；消息仍保留原文。
{
  await seed("s-plain", "chk:plain")
  const r = await dl.refresh("s-plain", { force: true })
  assert.equal(r.errorKind, "risk", "403 不应被当成需要登录")
  assert.match(r.error ?? "", /403/)
}

// 冷却/429 优先于 auth（同一请求可能同时带登录失败，先给可行动的原因）。
assert.equal(errorKindOf(new Error("平台冷却中(bilibili, 剩余 30s, 429)")), "rate-limit")
assert.equal(errorKindOf(new Error("401 Unauthorized: cookie expired")), "auth")
assert.equal(errorKindOf(new Error("fetch failed: ECONNRESET")), "network")
assert.equal(errorKindOf(new Error("被动采集：没有可用的数据")), "no-data")

await dl.subscriptions.remove("s-auth")
await dl.subscriptions.remove("s-plain")

console.log("✔ 错误分类自检通过（errorKind 透出 / 403→risk / 冷却→rate-limit / no-data）")
