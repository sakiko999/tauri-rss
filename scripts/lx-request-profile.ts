/**
 * lx-request-profile —— 量「一次订阅刷新」实际打出多少请求、多大响应、多快。
 *
 * 风控配额的初值不该靠试探平台上限（那本身就是触发风控的行为），而应从
 * 「真实刷新节奏 × 每渠道扇出」反推。本脚本对一批匿名可用渠道各抓一次，
 * 统计：请求数、状态码、总字节、耗时分布。
 *
 * 用法：bun scripts/lx-request-profile.ts [渠道 key ...]
 * 不带参数跑 DEFAULT_CHANNELS。
 */
import { setupHost } from "../apps/cli/src/host/node-host.ts"

const DEFAULT_CHANNELS = [
  "bili:popular",
  "bili:precious",
  "bili:weekly",
  "bili:ranking",
  "bili:square",
  "bili:live:hot",
  "live:douyu:hot",
  "live:huya:hot",
  "live:douyin:hot",
  "weibo:hot",
  "xhs:explore",
  "douyin:trend",
  "apple:podcast-chart",
  "rss:hn",
]

interface Call {
  url: string
  status: number | string
  ms: number
  bytes: number
}

const calls: Call[] = []
const realFetch = globalThis.fetch
// ⚠️ 必须在 setupHost / channel import 之前打补丁：nodeBackend 在请求时读全局 fetch。
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : String(input?.url ?? input)
  const t = performance.now()
  try {
    const res = await realFetch(input, init)
    calls.push({
      url,
      status: res.status,
      ms: Math.round(performance.now() - t),
      bytes: Number(res.headers.get("content-length") ?? 0),
    })
    return res
  } catch (e) {
    calls.push({ url, status: "ERR", ms: Math.round(performance.now() - t), bytes: 0 })
    throw e
  }
}) as typeof fetch

setupHost()

const { getChannel } = await import("../packages/crawler/src/index.ts")
const { buildInfo } = await import("../apps/cli/src/info.ts")

const keys = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_CHANNELS

for (const key of keys) {
  const ch = getChannel(key)
  if (!ch) {
    console.log(JSON.stringify({ key, error: "unknown channel" }))
    continue
  }
  const start = calls.length
  const t0 = performance.now()
  let count = 0
  let error: string | undefined
  try {
    const info = await buildInfo(key, {})
    const xml = await ch.getSource(info).fetch()
    count = (xml.match(/<item[\s>]/g) ?? []).length
  } catch (e) {
    error = String((e as Error)?.message ?? e).slice(0, 200)
  }
  const mine = calls.slice(start)
  const hosts = [...new Set(mine.map((c) => hostOf(c.url)))]
  console.log(
    JSON.stringify({
      key,
      ok: !error,
      items: count,
      ms: Math.round(performance.now() - t0),
      requests: mine.length,
      totalBytes: mine.reduce((s, c) => s + c.bytes, 0),
      hosts,
      statuses: mine.map((c) => c.status),
      urls: mine.map((c) => shortUrl(c.url)),
      error,
    }),
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return "-"
  }
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.host}${u.pathname}`.slice(0, 90)
  } catch {
    return url.slice(0, 90)
  }
}
