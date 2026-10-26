/**
 * NetworkGovernor 自检 —— 覆盖 docs/crawler-risk-control.md §2 的准入行为。
 * 跑:`bun packages/host/src/example/governor.check.ts`
 *
 * 用假后端 + 短 minInterval(20~40ms),不碰真实网络。
 */
import assert from "node:assert/strict"
import { setLogSink } from "@amoeba/log"
import { injectNodeHost } from "../index.ts"
import {
  browserGate,
  classifyRequest,
  configureNetwork,
  effectivePlatformPolicy,
  governedHttp,
  governorStats,
  levelFor,
  reportRisk,
} from "../net/governor.ts"

// 注入内存 storage:冷却持久化路径能跑通(读不到内容也应当静默)。
injectNodeHost()
// 本自检会故意触发多次冷却:warn 收集起来断言,别让它们混进断言输出。
const logLines: string[] = []
setLogSink((_level, text) => logLines.push(text))

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

let calls = 0

/** 假 HttpBackend:记录调用次数,可设延迟/状态码。 */
function fakeBackend(opts: { delayMs?: number; status?: number } = {}): HttpBackend {
  return {
    async request() {
      calls++
      if (opts.delayMs) await sleep(opts.delayMs)
      return { status: opts.status ?? 200, headers: {}, body: "ok" }
    },
  }
}

console.log("── 分类:平台 / 计量 ──")
{
  // 平台由 host 推导(含子域)。
  assert.equal(classifyRequest("https://api.bilibili.com/x/web-interface/nav").platform, "bili")
  assert.equal(classifyRequest("https://api.live.bilibili.com/room").platform, "bili")
  assert.equal(classifyRequest("https://app.bilibili.com/x/v2/rank").platform, "bili")
  assert.equal(classifyRequest("https://m.weibo.cn/api/container").platform, "weibo")
  assert.equal(classifyRequest("https://weibo.com/ajax").platform, "weibo")
  assert.equal(classifyRequest("https://www.xiaohongshu.com/explore").platform, "xhs")
  assert.equal(classifyRequest("https://live.douyin.com/webcast").platform, "douyin")
  assert.equal(classifyRequest("https://www.douyu.com/japi").platform, "douyu")
  assert.equal(classifyRequest("https://www.huya.com/cache.php").platform, "huya")
  assert.equal(classifyRequest("https://youtubei.googleapis.com/youtubei/v1").platform, "youtube")
  assert.equal(classifyRequest("https://itunes.apple.com/search").platform, "apple")
  // RSSHub:公网实例按域名归桶;自建实例(任意域名)由调用方显式声明。
  assert.equal(classifyRequest("https://rsshub.app/weibo/user/1").platform, "rsshub")
  assert.equal(classifyRequest("https://rsshub.app/").platform, "rsshub")
  assert.equal(
    classifyRequest("https://hub.example.org/feed/1", { platform: "rsshub" }).platform,
    "rsshub",
    "自建 RSSHub 实例应能显式归入 rsshub 桶",
  )
  // 请求级 platform 也决定配额桶(与 host 推导同一条路):rsshub 不再落进通用桶。
  assert.notEqual(
    effectivePlatformPolicy("rsshub").rpm,
    effectivePlatformPolicy("rss.example.org").rpm,
    "rsshub 应有独立配额",
  )
  // 未知 host:去掉 www 后原样作平台(每站一个桶)。
  assert.equal(classifyRequest("https://www.rss.example.org/feed").platform, "rss.example.org")

  // 不计量:本地、图片/媒体扩展名、已知媒体 CDN(无扩展名也算)。
  assert.equal(classifyRequest("http://localhost:9223/json/list").metered, false)
  assert.equal(classifyRequest("http://127.0.0.1:1420/index.html").metered, false)
  assert.equal(classifyRequest("https://i0.hdslb.com/bfs/archive/a.jpg").metered, false)
  assert.equal(classifyRequest("https://upos-sz-mirror.bilivideo.com/x.m4s").metered, false)
  assert.equal(classifyRequest("https://cdn.example.org/clip.mp4?token=1").metered, false)
  assert.equal(classifyRequest("https://cdn.example.org/live.m3u8").metered, false)
  assert.equal(classifyRequest("https://www.googlevideo.com/videoplayback").metered, false)
  // 计量:API(即使 query 里像图片名)。
  assert.equal(classifyRequest("https://api.bilibili.com/x?file=a.jpg").metered, true)
  // 请求级覆盖优先。
  assert.equal(classifyRequest("https://api.bilibili.com/x", { metered: false }).metered, false)
  const overridden = classifyRequest("https://cdn.example.org/a.jpg", {
    metered: true,
    platform: "bili",
  })
  assert.equal(overridden.metered, true)
  assert.equal(overridden.platform, "bili")
}

console.log("── L0:直通(不排队/不去重) ──")
{
  configureNetwork({ level: 0 })
  calls = 0
  const http = governedHttp(fakeBackend({ delayMs: 20 }))
  const results = await Promise.all([
    http.request({ url: "https://api.bilibili.com/x" }),
    http.request({ url: "https://api.bilibili.com/x" }),
    http.request({ url: "https://api.bilibili.com/y" }),
  ])
  assert.equal(calls, 3, "L0 不应去重")
  assert.ok(results.every((r) => r.status === 200))
}

console.log("── 平台覆盖:同一时刻各平台不同等级 ──")
{
  configureNetwork({
    level: 1,
    levels: { bili: 3, "loose.test": 0 },
    platforms: {
      "default.test": { maxConcurrent: 2, rpm: 100, minIntervalMs: 0, cooldownBaseMs: 1000 },
    },
  })
  assert.equal(levelFor("bili"), 3, "精确平台覆盖生效")
  assert.equal(levelFor("loose.test"), 0)
  assert.equal(levelFor("default.test"), 1, "未覆盖平台继承全局")

  calls = 0
  const http = governedHttp(fakeBackend())
  const strict = await http.request({ url: "https://api.bilibili.com/x/web-interface/nav" })
  assert.equal(strict.status, 200, "覆盖为严格档仍应放行(只是配额更紧)")

  const loose = await http.request({ url: "https://loose.test/a" })
  assert.equal(loose.status, 200, "平台设 0 时应直通")
  const normal = await http.request({ url: "https://default.test/b" })
  assert.equal(normal.status, 200, "未覆盖平台仍按全局 L1 放行")

  // `"*"` 是未知 host / RSS 的兜底覆盖,精确平台优先于它。
  configureNetwork({ levels: { "*": 3, bili: 1 } })
  assert.equal(levelFor("other.test"), 3)
  assert.equal(levelFor("bili"), 1)

  // levels 是整表替换:清空后回到全局默认。
  configureNetwork({ levels: {} })
  assert.equal(levelFor("bili"), 1)
}

console.log("── 去重:并发相同请求共享同一 promise ──")
{
  configureNetwork({
    level: 1,
    platforms: {
      "dedupe.test": { maxConcurrent: 2, rpm: 100, minIntervalMs: 0, cooldownBaseMs: 1000 },
    },
  })
  calls = 0
  const http = governedHttp(fakeBackend({ delayMs: 30 }))
  const [a, b] = await Promise.all([
    http.request({ url: "https://dedupe.test/same", method: "POST", body: "a=1" }),
    http.request({ url: "https://dedupe.test/same", method: "POST", body: "a=1" }),
  ])
  assert.equal(calls, 1, "method+url+body 相同应共享")
  assert.equal(a.body, b.body)

  // 落定后不缓存结果:下一次重新请求。
  await http.request({ url: "https://dedupe.test/same", method: "POST", body: "a=1" })
  assert.equal(calls, 2, "in-flight 去重不缓存结果")

  // dedupeKey 显式覆盖(不同 URL 也可合并)。
  calls = 0
  const httpKey = governedHttp(fakeBackend({ delayMs: 20 }))
  await Promise.all([
    httpKey.request({ url: "https://dedupe.test/a", policy: { dedupeKey: "shared" } }),
    httpKey.request({ url: "https://dedupe.test/b", policy: { dedupeKey: "shared" } }),
  ])
  assert.equal(calls, 1, "dedupeKey 相同的并发请求应共享")
}

console.log("── 冷却:未到期 reject,到期自动恢复 ──")
{
  configureNetwork({
    platforms: {
      "cool.test": { maxConcurrent: 1, rpm: 100, minIntervalMs: 0, cooldownBaseMs: 60 },
    },
  })
  calls = 0
  const http = governedHttp(fakeBackend())

  assert.equal(governorStats().cooldowns["cool.test"], undefined)
  reportRisk("cool.test", "unknown-signal") // 未知信号 → cooldownBaseMs(60ms)
  assert.ok((governorStats().cooldowns["cool.test"] ?? 0) > 0, "显式信号应写冷却")
  assert.ok(
    logLines.some((l) => l.includes("平台进入冷却 cool.test") && l.includes("unknown-signal")),
    "新冷却应打一条 host:net warn(否则刷新变慢时无法定位)",
  )
  const logCount = logLines.length
  reportRisk("cool.test", "another-signal")
  assert.equal(logLines.length, logCount, "冷却期内的重复信号不应再打日志(只刷新原因)")

  await assert.rejects(() => http.request({ url: "https://cool.test/api" }), /冷却/)
  assert.equal(calls, 0, "冷却期内不应发出请求")

  await sleep(80)
  assert.equal(governorStats().cooldowns["cool.test"], undefined, "到期后冷却应清除")
  const ok = await http.request({ url: "https://cool.test/api" })
  assert.equal(ok.status, 200, "冷却到期后恢复")

  // 媒体平台名不写冷却(§2.3 规则 1)。
  reportRisk("i0.hdslb.com", "412")
  assert.equal(governorStats().cooldowns["i0.hdslb.com"], undefined, "媒体 CDN 不记冷却")
}

console.log("── 状态码自动写冷却(仅计量) ──")
{
  configureNetwork({
    platforms: {
      "risk.test": { maxConcurrent: 1, rpm: 100, minIntervalMs: 0, cooldownBaseMs: 50 },
    },
  })
  const http = governedHttp(fakeBackend({ status: 412 }))
  const res = await http.request({ url: "https://risk.test/api" })
  assert.equal(res.status, 412)
  assert.ok((governorStats().cooldowns["risk.test"] ?? 0) > 0, "412 应自动写冷却")
  calls = 0
  await assert.rejects(() => http.request({ url: "https://risk.test/api" }), /冷却/)
  assert.equal(calls, 0, "冷却期内不再发请求")
}

console.log("── 冷却时长:平台 + 信号映射 ──")
{
  reportRisk("bili", "412")
  const left = governorStats().cooldowns["bili"] ?? 0
  assert.ok(left > 14 * 60_000 && left <= 15 * 60_000, `bili 412 应冷却 15min(实际 ${left}ms)`)

  reportRisk("weibo", "432")
  const weiboLeft = governorStats().cooldowns["weibo"] ?? 0
  assert.ok(weiboLeft > 9 * 60_000 && weiboLeft <= 10 * 60_000, "weibo 432 应冷却 10min")
}

console.log("── 等级分档:L1 入门 / L2 标准 / L3 严格 ──")
{
  configureNetwork({
    level: 1,
    platforms: {
      "tier.test": { maxConcurrent: 4, rpm: 40, minIntervalMs: 40, cooldownBaseMs: 1000 },
    },
  })
  const l1 = effectivePlatformPolicy("tier.test")
  assert.equal(l1.maxConcurrent, 4)
  assert.equal(l1.rpm, 40)
  assert.equal(l1.minIntervalMs, 40)

  configureNetwork({ level: 2 })
  const l2 = effectivePlatformPolicy("tier.test")
  assert.equal(l2.maxConcurrent, 2, "L2 并发减半")
  assert.equal(l2.rpm, 20, "L2 RPM 减半")
  assert.equal(l2.minIntervalMs, 80, "L2 最小间隔加倍")
  assert.equal(l2.cooldownBaseMs, 1000, "冷却基础值不随等级变")

  configureNetwork({ level: 3 })
  const l3 = effectivePlatformPolicy("tier.test")
  assert.equal(l3.maxConcurrent, 1, "L3 并发继续收紧")
  assert.equal(l3.rpm, 10, "L3 RPM 再减半")
  assert.equal(l3.minIntervalMs, 160, "L3 最小间隔再加倍")

  // 平台覆盖优先于全局:全局 L3 时该平台设 L1 仍按 L1 放行。
  configureNetwork({ level: 3, levels: { "tier.test": 1 } })
  assert.equal(effectivePlatformPolicy("tier.test").rpm, 40, "平台覆盖应压过全局档")
  configureNetwork({ level: 1, levels: {} })
}

console.log("── 并发上限:平台 / 全局 ──")
{
  configureNetwork({
    platforms: {
      "conc.test": { maxConcurrent: 2, rpm: 1000, minIntervalMs: 0, cooldownBaseMs: 1000 },
    },
  })
  let active = 0
  let peak = 0
  const http = governedHttp({
    async request() {
      active++
      peak = Math.max(peak, active)
      await sleep(25)
      active--
      return { status: 200, headers: {}, body: "ok" }
    },
  })
  await Promise.all(
    Array.from({ length: 6 }, (_, i) => http.request({ url: `https://conc.test/${i}` })),
  )
  assert.equal(peak, 2, `平台并发应封顶 2(实际 ${peak})`)
  assert.equal(active, 0)

  configureNetwork({
    globalMaxConcurrent: 2,
    platforms: {
      "ga.test": { maxConcurrent: 5, rpm: 1000, minIntervalMs: 0, cooldownBaseMs: 1000 },
      "gb.test": { maxConcurrent: 5, rpm: 1000, minIntervalMs: 0, cooldownBaseMs: 1000 },
    },
  })
  let gActive = 0
  let gPeak = 0
  const gHttp = governedHttp({
    async request() {
      gActive++
      gPeak = Math.max(gPeak, gActive)
      await sleep(25)
      gActive--
      return { status: 200, headers: {}, body: "ok" }
    },
  })
  await Promise.all([
    ...Array.from({ length: 3 }, (_, i) => gHttp.request({ url: `https://ga.test/${i}` })),
    ...Array.from({ length: 3 }, (_, i) => gHttp.request({ url: `https://gb.test/${i}` })),
  ])
  assert.equal(gPeak, 2, `全局并发应封顶 2(实际 ${gPeak})`)
  assert.equal(gActive, 0)
}

console.log("── 浏览器闸门:冷却拒绝 / 最小间隔 / L0 直通 ──")
{
  configureNetwork({ level: 1, levels: {} })

  // 风控信号写入的冷却必须能拦住浏览器操作 —— CDP 流量不走 governedHttp,
  // 这是 xhs/weibo 真实账号主路径唯一的退避入口。
  reportRisk("xhs", "verify-box")
  await assert.rejects(() => browserGate("xhs"), /平台冷却中/)

  // 无冷却的平台:连续两次浏览器操作至少隔一个基准间隔(600ms + 0~400ms 抖动)。
  const t0 = Date.now()
  await browserGate("douyu")
  await browserGate("douyu")
  const gap = Date.now() - t0
  assert.ok(gap >= 550, `浏览器操作应受最小间隔约束(实际 ${gap}ms)`)

  // L0 直通:调试档不排队。
  configureNetwork({ level: 0, levels: {} })
  const t1 = Date.now()
  await browserGate("douyu")
  await browserGate("douyu")
  assert.ok(Date.now() - t1 < 200, "L0 不应受浏览器闸门约束")
}

// 恢复默认等级,避免后续本进程内其它自检受影响。
configureNetwork({ level: 1, levels: {} })

// 统计面板数据:最近一次耗时 + 累计流量/请求数(具体数值取决于请求体,只断言有记录)。
{
  const s = governorStats()
  assert.ok(s.lastLatency && s.lastLatency.ms >= 0, "应记录最近一次 HTTP 耗时")
  assert.ok(s.network.requests > 0, "应累计出站请求数")
  assert.ok(s.network.bytes > 0, "应累计响应体大小")
}

console.log("✔ NetworkGovernor 自检通过(分类 / L0 直通 / 平台覆盖 / 去重 / 冷却 / 等级分档 / 并发上限 / 浏览器闸门 / 统计)")
