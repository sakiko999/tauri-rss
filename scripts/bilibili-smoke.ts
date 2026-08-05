/**
 * Bilibili smoke — 真实抓取 bilibili 热搜，验证 wbi 签名 + BilibiliSource 链路。
 * 用 Node 原生 fetch 做 http backend（只读脚本，不污染 core）。
 * Run: `bun run scripts/bilibili-smoke.ts`
 */
import { BilibiliSource } from "../packages/producer/src/source/bilibili/bilibili-source.ts"

const host = {
  now: () => Date.now(),
  http: {
    async request(o: { url: string; method: string; responseType: string; headers?: Record<string, string> }) {
      const res = await fetch(o.url, {
        method: o.method,
        headers: o.headers ?? {},
        redirect: "follow",
      })
      const text = await res.text()
      return { status: res.status, headers: {}, body: o.responseType === "json" ? JSON.parse(text) : text }
    },
  },
  storage: { async get() { return null }, async set() {}, async delete() {}, async keys() { return [] } },
  js: { eval() { return undefined }, call() { return undefined } },
  log: { log() {} },
}

const src = new BilibiliSource()
const items = await src.fetch(
  { id: "bili-rank", sourceId: "bilibili", title: "bilibili热搜", enabled: true, createdAt: 0, updatedAt: 0, config: { route: "hot-search" } },
  host as never,
)
console.log(`✅ 抓取 ${items.length} 条热搜`)
for (const it of items.slice(0, 5)) {
  console.log(`  - ${(it as { title: string }).title}  →  ${(it as { url: string }).url}`)
}
