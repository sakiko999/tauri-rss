/**
 * DataLayer 被动采集属性 + 等级闸门 + 自动刷新开关自检(风控 §2.4 / §3.8)。
 *
 * 覆盖:
 *   1. 普通渠道 L1 → 走 source.fetch();
 *   2. **被动渠道**(`RssChannel.passive`)不跟随防御等级(L0 / L3 / 渠道覆盖都不改变它)
 *      → 只调 fetchPassive,绝不调 fetch();
 *   2.5 被动数据缺失 → 复用内容缓存(即使过期);无缓存 → 如实报错;
 *   3. autoRefresh=false:非 force 不发网络(过期缓存照用),force 照抓;
 *   4. 显式渠道覆盖投影到宿主 governor(L0 优先 / 1~3 取严格 / 被动渠道不参与);
 *   5. L0(调试直通)同样走 source.fetch()。
 *
 * 跑:`bun packages/core/src/example/passive-mode.check.ts`
 * 最小断言(非框架):内存存储 + 假 channel,不触网 —— 判的是编排逻辑,不是抓取。
 */
import assert from "node:assert/strict"
import { injectNodeHost } from "@amoeba/host/node"
import { levelFor } from "@amoeba/host/governor"
import { getChannel, registerAllChannels, registerChannel } from "@amoeba/crawler"
import { serializeFeed } from "@amoeba/xml"
import { createDataLayer } from "../index.ts"
import type { Subscription } from "../types/subscription.ts"

injectNodeHost()
// 被动渠道只在**有浏览器**时生效(移动端/CLI 回落主动抓取);自检覆盖门面注入空壳浏览器。
Object.defineProperty(globalThis.appHost, "browser", { configurable: true, value: {} })
registerAllChannels()

// 回归:被动属性按渠道声明 —— xhs:user 匿名必须走页面内 fetch(匿名 profile SSR 抹空
// noteId),不能继承基类的 passive;xhs:explore 登录/匿名都读 SSR,应声明。
assert.equal(getChannel("xhs:user")?.passive ?? false, false, "xhs:user 不得声明 passive")
assert.equal(getChannel("xhs:explore")?.passive, true, "xhs:explore 应声明 passive")

const dl = createDataLayer()
const t = Date.now()

/** 假渠道:fetch / fetchPassive 各自计数,用来断言「被动渠道绝不走主动抓取」。 */
let fetchCalls = 0
let passiveCalls = 0
/** null = 本轮没有被动数据。 */
let passiveXml: string | null = null

function feed(id: string, title: string): string {
  return serializeFeed(
    [{ id, sourceId: "chk:active", kind: "article", title, url: `https://example.com/${id}`, fetchedAt: Date.now() }],
    { channelTitle: "LX 测试源" },
  )
}

/** 普通渠道:正常走主动 fetch。 */
registerChannel({
  key: "chk:active",
  name: "主动源",
  kind: "article",
  getSource: () => ({
    fetch: async () => {
      fetchCalls++
      return feed("active-1", "主动抓取")
    },
    // 即使 source 上有 fetchPassive,非 passive 渠道也不得被调用。
    fetchPassive: async () => {
      passiveCalls++
      return passiveXml
    },
  }),
})

/** 被动渠道(passive 属性):有浏览器就只读页面自然产生的数据。 */
registerChannel({
  key: "chk:passive",
  name: "被动源",
  kind: "article",
  passive: true,
  getSource: () => ({
    fetch: async () => {
      fetchCalls++
      return feed("active-passive", "主动抓取(不应发生)")
    },
    fetchPassive: async () => {
      passiveCalls++
      return passiveXml
    },
  }),
})

/** 造订阅(绕过 addSubscription 的自动 refresh,避免种子阶段先抓一次)。 */
async function seed(id: string, channelKey = "chk:active"): Promise<void> {
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

// ── 1. L1(默认等级):普通渠道走主动 fetch ──
await dl.settings.set({ netLevel: 1, netLevels: {}, autoRefresh: true })
await seed("chk-active")
{
  const r = await dl.refresh("chk-active", { force: true })
  assert.equal(r.error, undefined, "L1 正常抓取不应报错")
  assert.equal(fetchCalls, 1, "L1 应走 source.fetch()")
  assert.equal(passiveCalls, 0, "普通渠道不应调 fetchPassive()")
  assert.equal(dl.store.query({ subscriptionId: "chk-active" })[0]?.id, "active-1")
}

// ── 2. 被动渠道:不跟随等级,只调 fetchPassive ──
{
  await seed("chk-passive", "chk:passive")
  passiveXml = feed("passive-1", "被动抓取")
  const beforeFetch = fetchCalls
  const beforePassive = passiveCalls
  const r = await dl.refresh("chk-passive", { force: true })
  assert.equal(r.error, undefined, "被动渠道有数据应正常返回")
  assert.equal(passiveCalls, beforePassive + 1, "被动渠道应调 fetchPassive()")
  assert.equal(fetchCalls, beforeFetch, "被动渠道绝不调用 fetch()")
  assert.equal(dl.store.query({ subscriptionId: "chk-passive" })[0]?.id, "passive-1", "应使用被动采集结果")
}

// ── 2.5 被动数据缺失 → 复用缓存(即使过期),仍不 fetch ──
{
  passiveXml = null
  await ageCache("chk-passive")
  const beforeFetch = fetchCalls
  const beforePassive = passiveCalls
  const r = await dl.refresh("chk-passive", { force: true })
  assert.equal(r.error, undefined, "被动渠道无数据但有缓存 → 不该报错")
  assert.equal(r.itemCount, 1, "应从缓存重建 1 条")
  assert.equal(passiveCalls, beforePassive + 1)
  assert.equal(fetchCalls, beforeFetch, "被动渠道无数据也绝不回退 fetch()")
  assert.equal(dl.store.query({ subscriptionId: "chk-passive" })[0]?.id, "passive-1", "应复用缓存内容")
}

// ── 2.6 无浏览器(移动端/CLI):被动渠道回落主动抓取 ──
{
  const shell = globalThis.appHost.browser
  Object.defineProperty(globalThis.appHost, "browser", { configurable: true, value: undefined })
  try {
    await seed("chk-passive-mobile", "chk:passive")
    const beforeFetch = fetchCalls
    const beforePassive = passiveCalls
    const r = await dl.refresh("chk-passive-mobile", { force: true })
    assert.equal(r.error, undefined)
    assert.equal(fetchCalls, beforeFetch + 1, "无浏览器时被动渠道应回落 fetch()")
    assert.equal(passiveCalls, beforePassive, "无浏览器时不得调 fetchPassive()")
  } finally {
    Object.defineProperty(globalThis.appHost, "browser", { configurable: true, value: shell })
  }
}

// ── 2.8 被动属性不跟随防御等级:L0 / L3 / 渠道覆盖 L0 都不得让它改走 fetch ──
{
  await seed("chk-passive-lv", "chk:passive")
  const cases: Array<{
    label: string
    cfg: { netLevel: 0 | 1 | 2 | 3; netLevels: Record<string, 0 | 1 | 2 | 3> }
  }> = [
    { label: "L0", cfg: { netLevel: 0, netLevels: {} } },
    { label: "L3", cfg: { netLevel: 3, netLevels: {} } },
    { label: "渠道覆盖 L0", cfg: { netLevel: 1, netLevels: { "chk:passive": 0 } } },
  ]
  for (const { label, cfg } of cases) {
    await dl.settings.set({ ...cfg, autoRefresh: true })
    passiveXml = feed(`passive-${label}`, label)
    const beforeFetch: number = fetchCalls
    const beforePassive: number = passiveCalls
    const r = await dl.refresh("chk-passive-lv", { force: true })
    assert.equal(r.error, undefined, `${label}: 被动渠道不应报错`)
    assert.equal(passiveCalls, beforePassive + 1, `${label}: 被动渠道仍应走 fetchPassive`)
    assert.equal(fetchCalls, beforeFetch, `${label}: 等级不得让被动渠道改走 fetch`)
  }
  await dl.settings.set({ netLevel: 1, netLevels: {} })
}

// ── 2.7 被动数据缺失且无缓存 → 如实报错(仍不联网) ──
{
  await seed("chk-passive-empty", "chk:passive")
  passiveXml = null
  const beforeFetch = fetchCalls
  const r = await dl.refresh("chk-passive-empty", { force: true })
  assert.equal(r.error, "被动采集：没有可用的数据，且无缓存可回退")
  assert.equal(r.errorKind, "no-data")
  assert.equal(r.itemCount, 0)
  assert.equal(fetchCalls, beforeFetch, "被动渠道无缓存也不得回退 fetch()")
}

// ── 2.9 预览与刷新同一条被动承诺：有浏览器时只调 fetchPassive，无数据报 no-data ──
{
  passiveXml = feed("preview-1", "预览内容")
  const beforeFetch = fetchCalls
  const beforePassive = passiveCalls
  const p = await dl.previewChannel("chk:passive", {})
  assert.equal(p.items[0]?.id, "preview-1", "预览应使用被动数据")
  assert.equal(passiveCalls, beforePassive + 1, "预览被动渠道应调 fetchPassive()")
  assert.equal(fetchCalls, beforeFetch, "预览被动渠道不得回退 fetch()")

  passiveXml = null
  await assert.rejects(
    () => dl.previewChannel("chk:passive", {}),
    (e: any) => e?.kind === "no-data",
    "预览无被动数据应报 no-data",
  )
}

// ── 3. 渠道覆盖优先于平台/全局 ──
{
  // 全局 L3 + 该渠道覆盖 L1 → 走主动(等级只影响配额,不改变被动属性)
  await dl.settings.set({ netLevel: 3, netLevels: { "chk:active": 1 } })
  const beforeFetch = fetchCalls
  const r = await dl.refresh("chk-active", { force: true })
  assert.equal(r.error, undefined)
  assert.equal(fetchCalls, beforeFetch + 1, "渠道覆盖 L1 时应走 fetch()")

  // `"*"` 兜底覆盖同样生效(未知渠道)
  await dl.settings.set({ netLevel: 3, netLevels: { "*": 1 } })
  const beforeFetch2 = fetchCalls
  await dl.refresh("chk-active", { force: true })
  assert.equal(fetchCalls, beforeFetch2 + 1, "`*` 覆盖应接管未知渠道")

  // 复位(后续用例不依赖覆盖)
  await dl.settings.set({ netLevel: 1, netLevels: {} })
}

// ── 4.7 旧版 channelKey 覆盖折叠到平台(设置页已只按平台;这里锁兼容路径) ──
{
  // 单渠道 L0 → 该平台直通:否则「渠道设 L0」在冷却/配额层完全不生效
  // (全局 L1 + bili:live:hot = 0,刷新仍会被平台冷却拒绝)。
  await dl.settings.set({ netLevel: 1, netLevels: { "bili:live:hot": 0 } })
  assert.equal(levelFor("bili"), 0, "渠道 L0 应投影到平台并覆盖全局 L1")
  // 1~3 取更严格者(安全侧:不因个别渠道收紧而误放同平台请求)。
  await dl.settings.set({ netLevel: 1, netLevels: { "bili:live:hot": 3 } })
  assert.equal(levelFor("bili"), 3, "渠道 L3 应投影到平台")
  // 被动渠道不产生主动请求,它的存量覆盖不参与投影。
  await dl.settings.set({ netLevel: 1, netLevels: { "xhs:explore": 0 } })
  assert.equal(levelFor("xhs"), 1, "被动渠道的覆盖不投影到平台")
  await dl.settings.set({ netLevel: 1, netLevels: {} })
  assert.equal(levelFor("bili"), 1, "清空渠道覆盖后回落全局等级")
}

// ── 4.8 旧版 channelKey 键在启动时折叠成平台键(设置页已只按平台) ──
{
  await dl.settings.set({
    netLevel: 1,
    netLevels: { "bili:live:hot": 0, "weibo:user": 2, "xhs:explore": 3 },
  })
  // 新 DataLayer 的启动同步会折叠并回写(memStorage 是同一个实例)。
  const dl2 = createDataLayer()
  let migrated = (await dl2.settings.get()).netLevels
  for (let i = 0; i < 20 && migrated["bili:live:hot"] !== undefined; i++) {
    await new Promise((r) => setTimeout(r, 10))
    migrated = (await dl2.settings.get()).netLevels
  }
  assert.equal(migrated["bili:live:hot"], undefined, "渠道键应被折叠掉")
  assert.equal(migrated["bili"], 0, "渠道 L0 折叠到平台")
  assert.equal(migrated["weibo"], 2, "渠道 1~3 折叠到平台")
  assert.equal(migrated["xhs"], undefined, "被动渠道的存量键丢弃")
  assert.equal(levelFor("bili"), 0, "折叠结果应同步给 governor")
}

// ── 5. autoRefresh=false:非 force 不发网络(过期缓存照用),force 照抓 ──
{
  await dl.settings.set({ netLevel: 1, netLevels: {}, autoRefresh: false })
  await ageCache("chk-active")
  const beforeFetch = fetchCalls
  const passive = await dl.refresh("chk-active") // 非 force
  assert.equal(passive.error, undefined, "自动刷新关闭不是错误")
  assert.equal(passive.itemCount, 1, "应复用(过期)缓存")
  assert.equal(fetchCalls, beforeFetch, "autoRefresh=false 且非 force 不得发网络")

  const forced = await dl.refresh("chk-active", { force: true })
  assert.equal(forced.error, undefined)
  assert.equal(fetchCalls, beforeFetch + 1, "force(手动刷新)应绕过 autoRefresh 开关")
}

// ── 6. autoRefresh=false 且无缓存 → 0 条、不报错、不联网 ──
{
  await seed("chk-nocache")
  const beforeFetch = fetchCalls
  const r = await dl.refresh("chk-nocache")
  assert.equal(r.error, undefined, "无缓存也不是错误")
  assert.equal(r.itemCount, 0, "无缓存返回 0 条")
  assert.equal(fetchCalls, beforeFetch, "autoRefresh=false 不得发网络")
}

// ── 7. L0(调试直通)同样走 fetch ──
{
  await dl.settings.set({ netLevel: 0, netLevels: {}, autoRefresh: true })
  const beforeFetch = fetchCalls
  const r = await dl.refresh("chk-active", { force: true })
  assert.equal(r.error, undefined)
  assert.equal(fetchCalls, beforeFetch + 1, "L0 应走 source.fetch()")
}

for (const id of [
  "chk-active",
  "chk-passive",
  "chk-passive-empty",
  "chk-passive-mobile",
  "chk-passive-lv",
  "chk-nocache",
]) {
  await dl.subscriptions.remove(id)
}

console.log(
  "✔ 被动采集/等级自检通过(passive 只走 fetchPassive / 不随等级 / 无浏览器回落 / 缓存回退 / autoRefresh / 旧渠道键折叠 / L0-L1 走 fetch)",
)
