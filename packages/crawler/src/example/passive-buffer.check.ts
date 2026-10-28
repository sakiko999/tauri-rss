/**
 * PassiveBuffer 自检 —— `bun packages/crawler/src/example/passive-buffer.check.ts`
 * 覆盖：URL 归一化 / 同键覆盖 / TTL 过期 / 单条上限 / 总量淘汰 / getLatest / clear。
 */
import { PassiveBuffer, canonicalUrl } from "../passive/buffer.ts"

let fails = 0
const ok = (c: unknown, label: string) => {
  if (c) console.log(`  ✓ ${label}`)
  else {
    fails++
    console.error(`  ✗ ${label}`)
  }
}

// ── canonicalUrl ──────────────────────────────────────────────────────────────
const c1 = canonicalUrl("https://a.com/x?b=2&wts=99&a=1&xsec_token=zzz")
ok(c1 === "https://a.com/x?a=1&b=2", "归一化：剥易变参数 + 排序")

const c2 = canonicalUrl("https://a.com/x?a=1&a=2")
ok(c2 === "https://a.com/x?a=1&a=2", "归一化：保留重复参数")

const c3 = canonicalUrl("not-a-url")
ok(c3 === "not-a-url", "归一化：非法 URL 原样返回")

// ── 写读 / 同键覆盖 ──────────────────────────────────────────────────────────
let t = 0
const buf = new PassiveBuffer({ ttlMs: 1000, maxEntryBytes: 100, maxTotalBytes: 1000, now: () => t })

ok(
  buf.push({
    platform: "xhs",
    endpoint: "explore",
    url: "https://a.com/x?wts=1",
    status: 200,
    mime: "text/html",
    body: "v1",
  }),
  "push 成功",
)
t = 10
buf.push({
  platform: "xhs",
  endpoint: "explore",
  url: "https://a.com/x?wts=2",
  status: 200,
  mime: "text/html",
  body: "v2",
})
const got = buf.get("xhs", "explore", "https://a.com/x?wts=3")
ok(got?.body === "v2", "同键覆盖：不同签名参数命中同一份，取最新")
ok(buf.stats().count === 1, "同键覆盖后只有 1 条")

// ── TTL ──────────────────────────────────────────────────────────────────────
t = 1009
ok(buf.get("xhs", "explore", "https://a.com/x")?.body === "v2", "TTL 内可读")
t = 1011
ok(buf.get("xhs", "explore", "https://a.com/x") === null, "TTL 过期后读不到")
ok(buf.stats().count === 0, "过期条目被清掉")

// ── 单条上限 ────────────────────────────────────────────────────────────────
const small = new PassiveBuffer({ ttlMs: 1000, maxEntryBytes: 10, maxTotalBytes: 100, now: () => t })
ok(
  !small.push({ platform: "p", endpoint: "e", url: "https://a.com/1", status: 200, mime: "t", body: "x".repeat(11) }),
  "超单条上限拒绝",
)
ok(small.stats().count === 0, "拒绝后不占空间")

// ── 总量淘汰最旧 ────────────────────────────────────────────────────────────
let te = 0
const evict = new PassiveBuffer({ ttlMs: 1000, maxEntryBytes: 10, maxTotalBytes: 10, now: () => te })
evict.push({ platform: "p", endpoint: "e", url: "https://a.com/old", status: 200, mime: "t", body: "123456", at: 1 })
evict.push({ platform: "p", endpoint: "e", url: "https://a.com/new", status: 200, mime: "t", body: "abcdef", at: 2 })
ok(evict.get("p", "e", "https://a.com/old") === null, "超总量时淘汰最旧")
ok(evict.get("p", "e", "https://a.com/new")?.body === "abcdef", "保留最新")
ok(evict.stats().bytes === 6, "stats 字节数正确")

// ── getLatest ───────────────────────────────────────────────────────────────
let tl = 0
const latest = new PassiveBuffer({ ttlMs: 1000, now: () => tl })
latest.push({
  platform: "xhs",
  endpoint: "explore",
  url: "https://a.com/1",
  status: 200,
  mime: "t",
  body: "one",
  at: 5,
})
latest.push({
  platform: "xhs",
  endpoint: "explore",
  url: "https://a.com/2",
  status: 200,
  mime: "t",
  body: "two",
  at: 6,
})
latest.push({
  platform: "bili",
  endpoint: "explore",
  url: "https://a.com/3",
  status: 200,
  mime: "t",
  body: "other",
  at: 7,
})
ok(latest.getLatest("xhs", "explore")?.body === "two", "getLatest 取该平台/接口最新")
ok(latest.getLatest("nope", "explore") === null, "getLatest 无匹配返回 null")

// ── clear ───────────────────────────────────────────────────────────────────
latest.clear()
ok(latest.stats().count === 0 && latest.stats().bytes === 0, "clear 清空")

if (fails) {
  console.error(`\n${fails} 项失败`)
  process.exit(1)
}
console.log("\n全部通过")
