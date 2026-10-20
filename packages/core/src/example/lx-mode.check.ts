/**
 * DataLayer LX 闸门 + 自动刷新开关自检(风控 §2.4 / §3.8)。
 *
 * 覆盖:
 *   1. L0 / L1 → 走 source.fetch();
 *   2. LX → 只调 source.fetchPassive(),**绝不调 fetch()**;
 *   3. LX 下 fetchPassive 返回 null → 复用内容缓存(即使过期);
 *   4. LX 下无被动数据且无缓存 → 如实报错「LX 模式：没有可用的被动采集数据」;
 *   4.6 渠道未声明 supportsL9 → 不调 fetchPassive、不回退 fetch、如实报错;
 *   5. autoRefresh=false:非 force 不发网络(过期缓存照用),force 照抓;
 *      无缓存返回 0 条、不报错。
 *
 * 跑:`bun packages/core/src/example/lx-mode.check.ts`
 * 最小断言(非框架):内存存储 + 假 channel,不触网 —— 判的是编排逻辑,不是抓取。
 */
import assert from "node:assert/strict"
import { injectNodeHost, levelFor } from "@amoeba/host"
import { getChannel, registerAllChannels, registerChannel } from "@amoeba/crawler"
import { serializeFeed } from "@amoeba/xml"
import { createDataLayer } from "../index.ts"
import { BUILTIN_CHANNEL_LEVELS } from "../types/settings.ts"
import type { Subscription } from "../types/subscription.ts"

injectNodeHost()
registerAllChannels()

// 内置 L9 默认只应给声明了 supportsL9 的渠道;声明与默认不一致会在 L9 下静默退化。
for (const key of Object.keys(BUILTIN_CHANNEL_LEVELS)) {
  const c = getChannel(key)
  assert.equal(c?.supportsL9, true, `内置 L9 渠道 ${key} 必须声明 supportsL9`)
}
// explore 正常路径也是导航 + 读页面 SSR(匿名亦然),应与 user 一样默认 L9。
assert.equal(BUILTIN_CHANNEL_LEVELS["xhs:user"], 9)
assert.equal(BUILTIN_CHANNEL_LEVELS["xhs:explore"], 9)

const dl = createDataLayer()
const t = Date.now()

/** 假渠道:fetch / fetchPassive 各自计数,用来断言「LX 下绝不走主动抓取」。 */
let fetchCalls = 0
let passiveCalls = 0
/** null = 本轮没有被动数据。 */
let passiveXml: string | null = null

function feed(id: string, title: string): string {
  return serializeFeed(
    [{ id, sourceId: "chk:lx", kind: "article", title, url: `https://example.com/${id}`, fetchedAt: Date.now() }],
    { channelTitle: "LX 测试源" },
  )
}

registerChannel({
  key: "chk:lx",
  name: "LX 测试源",
  kind: "article",
  supportsL9: true,
  getSource: () => ({
    fetch: async () => {
      fetchCalls++
      return feed("active-1", "主动抓取")
    },
    fetchPassive: async () => {
      passiveCalls++
      return passiveXml
    },
  }),
})

/** 未声明 supportsL9 的渠道:即使 source 上恰好有 fetchPassive,core 也不得调用。 */
let unsupportedPassiveCalls = 0
registerChannel({
  key: "chk:nol9",
  name: "不支持 L9 的源",
  kind: "article",
  getSource: () => ({
    fetch: async () => {
      fetchCalls++
      return feed("active-nol9", "主动抓取")
    },
    fetchPassive: async () => {
      unsupportedPassiveCalls++
      return feed("passive-nol9", "被动抓取")
    },
  }),
})

/** 造订阅(绕过 addSubscription 的自动 refresh,避免种子阶段先抓一次)。 */
async function seed(id: string, channelKey = "chk:lx"): Promise<void> {
  const sub: Subscription = {
    id,
    channelKey,
    title: id,
    enabled: true,
    info: {},
    createdAt: t,
    updatedAt: t,
  }
  await dl.subscriptions.add(sub)
}

/** 把缓存 fetchedAt 改成一年前 —— 证明「即使过期」也复用(不看 TTL)。 */
async function ageCache(id: string): Promise<void> {
  const raw = await globalThis.appHost.storage.get(`content:${id}`)
  assert.ok(raw, "应有内容缓存")
  const entry = JSON.parse(raw!) as { fetchedAt: number; xml: string }
  entry.fetchedAt = Date.now() - 365 * 24 * 3600 * 1000
  await globalThis.appHost.storage.set(`content:${id}`, JSON.stringify(entry))
}

// ── 1. L1(默认等级):走主动 fetch ──
await dl.settings.set({ netLevel: 1, netLevels: {}, autoRefresh: true })
await seed("chk-lx")
{
  const r = await dl.refresh("chk-lx", { force: true })
  assert.equal(r.error, undefined, "L1 正常抓取不应报错")
  assert.equal(fetchCalls, 1, "L1 应走 source.fetch()")
  assert.equal(passiveCalls, 0, "L1 不应调 fetchPassive()")
  assert.equal(dl.store.query({ subscriptionId: "chk-lx" })[0]?.id, "active-1")
}

// ── 2. LX:只调 fetchPassive,绝不调 fetch ──
{
  passiveXml = feed("passive-1", "被动抓取")
  const beforeFetch = fetchCalls
  const beforePassive = passiveCalls
  // 全局默认不允许 9;用 `"*"` 覆盖把该测试渠道切到 L9。
  await dl.settings.set({ netLevel: 1, netLevels: { "*": 9 } })
  const r = await dl.refresh("chk-lx", { force: true })
  assert.equal(r.error, undefined, "LX 有被动数据应正常返回")
  assert.equal(passiveCalls, beforePassive + 1, "LX 应调 fetchPassive()")
  assert.equal(fetchCalls, beforeFetch, "LX 绝不调用 fetch()")
  assert.equal(dl.store.query({ subscriptionId: "chk-lx" })[0]?.id, "passive-1", "应使用被动采集结果")
}

// ── 3. LX 无被动数据 → 复用缓存(即使过期),仍不 fetch ──
{
  passiveXml = null
  await ageCache("chk-lx")
  const beforeFetch = fetchCalls
  const beforePassive = passiveCalls
  const r = await dl.refresh("chk-lx", { force: true })
  assert.equal(r.error, undefined, "LX 无被动数据但有缓存 → 不该报错")
  assert.equal(r.itemCount, 1, "应从缓存重建 1 条")
  assert.equal(passiveCalls, beforePassive + 1)
  assert.equal(fetchCalls, beforeFetch, "LX 无被动数据也绝不回退 fetch()")
  assert.equal(dl.store.query({ subscriptionId: "chk-lx" })[0]?.id, "passive-1", "应复用缓存内容")
}

// ── 4. LX 无被动数据且无缓存 → 如实报错(仍不联网) ──
{
  await seed("chk-lx-empty")
  passiveXml = null
  const beforeFetch = fetchCalls
  const r = await dl.refresh("chk-lx-empty", { force: true })
  assert.equal(r.error, "L9(LX) 模式：没有可用的被动采集数据")
  assert.equal(r.itemCount, 0)
  assert.equal(fetchCalls, beforeFetch, "LX 无缓存也不得回退 fetch()")
}

// ── 4.5 平台/渠道覆盖:全局等级与单渠道等级可不同 ──
{
  // 全局 L1 + 该渠道覆盖为 L9 → 只走被动
  await dl.settings.set({ netLevel: 1, netLevels: { "chk:lx": 9 } })
  passiveXml = feed("passive-2", "渠道覆盖")
  const beforeFetch = fetchCalls
  const r = await dl.refresh("chk-lx", { force: true })
  assert.equal(r.error, undefined)
  assert.equal(fetchCalls, beforeFetch, "渠道覆盖 lx 时不得走 fetch()")
  assert.equal(dl.store.query({ subscriptionId: "chk-lx" })[0]?.id, "passive-2", "应使用被动结果")

  // 全局 L3 + 该渠道覆盖为 L1 → 反向覆盖,走主动
  await dl.settings.set({ netLevel: 3, netLevels: { "chk:lx": 1 } })
  const beforeFetch2 = fetchCalls
  const r2 = await dl.refresh("chk-lx", { force: true })
  assert.equal(r2.error, undefined)
  assert.equal(fetchCalls, beforeFetch2 + 1, "渠道覆盖 L1 时应走 fetch()")

  // `"*"` 兜底覆盖同样生效(未知渠道)
  await dl.settings.set({ netLevel: 3, netLevels: { "*": 1 } })
  const beforeFetch3 = fetchCalls
  await dl.refresh("chk-lx", { force: true })
  assert.equal(fetchCalls, beforeFetch3 + 1, "`*` 覆盖应接管未知渠道")

  // 复位(后续用例不依赖覆盖)
  await dl.settings.set({ netLevel: 1, netLevels: {} })
}

// ── 4.6 未声明 supportsL9:不调 fetchPassive、不回退 fetch、如实报错 ──
{
  await seed("chk-lx-nol9", "chk:nol9")
  await dl.settings.set({ netLevel: 1, netLevels: { "*": 9 } })
  const beforeFetch = fetchCalls
  const beforePassive = unsupportedPassiveCalls
  const r = await dl.refresh("chk-lx-nol9", { force: true })
  assert.equal(r.error, "L9(LX)：渠道 chk:nol9 未声明支持浏览器被动采集")
  assert.equal(r.itemCount, 0)
  assert.equal(unsupportedPassiveCalls, beforePassive, "未声明 L9 的渠道不得调 fetchPassive()")
  assert.equal(fetchCalls, beforeFetch, "未声明 L9 也不得回退 fetch()")
  await dl.settings.set({ netLevel: 1, netLevels: {} })
}

// ── 4.7 显式渠道覆盖投影到宿主 governor(HTTP 层只认平台) ──
{
  // 单渠道 L0 → 该平台直通:否则「渠道设 L0」在冷却/配额层完全不生效
  // (全局 L1 + bili:live:hot = 0,刷新仍会被平台冷却拒绝)。
  await dl.settings.set({ netLevel: 1, netLevels: { "bili:live:hot": 0 } })
  assert.equal(levelFor("bili"), 0, "渠道 L0 应投影到平台并覆盖全局 L1")
  // L9 是 core 的抓取策略,不投影 —— 投影成平台会连带封掉该平台的详情/播放解析。
  await dl.settings.set({ netLevel: 1, netLevels: { "xhs:user": 9 } })
  assert.equal(levelFor("xhs"), 1, "渠道 L9 不投影到平台")
  // 1~3 取更严格者(安全侧:不因个别渠道收紧而误放同平台请求)。
  await dl.settings.set({ netLevel: 1, netLevels: { "bili:live:hot": 3 } })
  assert.equal(levelFor("bili"), 3, "渠道 L3 应投影到平台")
  await dl.settings.set({ netLevel: 1, netLevels: {} })
  assert.equal(levelFor("bili"), 1, "清空渠道覆盖后回落全局等级")
}

// ── 5. autoRefresh=false:非 force 不发网络(过期缓存照用),force 照抓 ──
{
  await dl.settings.set({ netLevel: 1, netLevels: {}, autoRefresh: false })
  await ageCache("chk-lx")
  const beforeFetch = fetchCalls
  const passive = await dl.refresh("chk-lx") // 非 force
  assert.equal(passive.error, undefined, "自动刷新关闭不是错误")
  assert.equal(passive.itemCount, 1, "应复用(过期)缓存")
  assert.equal(fetchCalls, beforeFetch, "autoRefresh=false 且非 force 不得发网络")

  const forced = await dl.refresh("chk-lx", { force: true })
  assert.equal(forced.error, undefined)
  assert.equal(fetchCalls, beforeFetch + 1, "force(手动刷新)应绕过 autoRefresh 开关")
}

// ── 6. autoRefresh=false 且无缓存 → 0 条、不报错、不联网 ──
{
  await seed("chk-lx-nocache")
  const beforeFetch = fetchCalls
  const r = await dl.refresh("chk-lx-nocache")
  assert.equal(r.error, undefined, "无缓存也不是错误")
  assert.equal(r.itemCount, 0, "无缓存返回 0 条")
  assert.equal(fetchCalls, beforeFetch, "autoRefresh=false 不得发网络")
}

// ── 7. L0(调试直通)同样走 fetch ──
{
  await dl.settings.set({ netLevel: 0, netLevels: {}, autoRefresh: true })
  const beforeFetch = fetchCalls
  const r = await dl.refresh("chk-lx", { force: true })
  assert.equal(r.error, undefined)
  assert.equal(fetchCalls, beforeFetch + 1, "L0 应走 source.fetch()")
}

await dl.subscriptions.remove("chk-lx")
await dl.subscriptions.remove("chk-lx-empty")
await dl.subscriptions.remove("chk-lx-nocache")
await dl.subscriptions.remove("chk-lx-nol9")

console.log("✔ LX 闸门自检通过(L9 只走 fetchPassive / 缺失回退缓存 / 未声明 L9 不调被动 / autoRefresh 开关 / 平台覆盖 / L0-L1 走 fetch)")
