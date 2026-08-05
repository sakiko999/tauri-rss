/**
 * producer 极简 example —— 命令行版"订阅内容输出"。
 *
 * 展示 producer 作为「极简 RSSHub」的核心能力:
 *   subscription → toXml → RSS 2.0 XML
 * 不依赖 core / Tauri / 浏览器——用 Node 原生 fetch 做 http backend,
 * 纯命令行打印。这也验证重构后 producer 的对外边界:只认订阅、产出 XML。
 *
 * 订阅源来自各 source 自带的 builtinSubscriptions(公开 RSS 链接/频道/直播房间),
 * 枚举 `listBuiltinSubscriptions()` 聚合。
 *
 * 用法:
 *   bun run scripts/producer-example.ts          # 打印每个订阅的可读摘要
 *   bun run scripts/producer-example.ts --xml    # 打印完整 RSS XML
 *   bun run scripts/producer-example.ts hn       # 只跑指定订阅 id(可用多个)
 */
// 走具体模块导入(与 core-smoke 一致),避免把 producer barrel 里无关面拉进来。
import type { ProducerHost } from "../packages/producer/src/types/producer-host.ts"
import { registerAllSources } from "../packages/producer/src/source/register-all.ts"
import { getSource, listBuiltinSubscriptions, type BuiltinEntry } from "../packages/producer/src/source/registry.ts"

/** 用 Node 原生 fetch 实现的 ProducerHost(只读脚本,不污染 core)。 */
function nodeHost(): ProducerHost {
  return {
    now: () => Date.now(),
    http: {
      async request(o: {
        url: string
        method?: string
        headers?: Record<string, string>
        responseType?: "text" | "json" | "arraybuffer"
        timeoutMs?: number
      }) {
        const res = await fetch(o.url, {
          method: o.method ?? "GET",
          headers: o.headers ?? {},
          redirect: "follow",
          signal: o.timeoutMs ? AbortSignal.timeout(o.timeoutMs) : undefined,
        })
        if (o.responseType === "arraybuffer") {
          const buf = new Uint8Array(await res.arrayBuffer())
          return { status: res.status, headers: {}, body: buf }
        }
        const text = await res.text()
        return { status: res.status, headers: {}, body: o.responseType === "json" ? JSON.parse(text) : text }
      },
    },
    storage: { async get() { return null }, async set() {}, async delete() {}, async keys() { return [] } },
    js: { eval() { return undefined }, call() { return undefined } },
    log: { log() {} },
  }
}

const args = process.argv.slice(2)
const wantXml = args.includes("--xml")
const only = args.filter((a) => !a.startsWith("--"))

/** 从各 source 的 builtinSubscriptions 选要跑的订阅:给了 id 就只跑那几条,否则全跑。 */
function pickBuiltins(): BuiltinEntry[] {
  const all = listBuiltinSubscriptions()
  if (!only.length) return all
  const picked = only
    .map((id) => all.find((e) => e.sub.id === id))
    .filter((e): e is BuiltinEntry => e !== undefined)
  if (!picked.length) {
    console.error(`没有匹配的订阅 id。可用: ${all.map((e) => e.sub.id).join(" / ")}`)
    process.exit(1)
  }
  return picked
}

async function main() {
  const host = nodeHost()
  registerAllSources(host)

  const picked = pickBuiltins()

  for (const { sourceId, sub } of picked) {
    console.log(`\n═══ ${sub.title} (source: ${sourceId}) ═══`)
    const adapter = getSource(sourceId)
    if (!adapter) {
      console.log(`  ⚠️ 无 adapter(未注册 source: ${sourceId})`)
      continue
    }
    const subscription = adapter.createSubscription
      ? adapter.createSubscription(
          { id: sub.id, sourceId, title: sub.title, enabled: true, createdAt: Date.now(), updatedAt: Date.now() },
          sub.config,
        )
      : { id: sub.id, sourceId, title: sub.title, enabled: true, createdAt: Date.now(), updatedAt: Date.now(), config: sub.config }
    try {
      if (wantXml) {
        // 对外统一出口:任意 source 都产标准 RSS 2.0 + tpl: XML。
        const xml = await adapter.toXml(subscription, host)
        console.log(xml)
      } else {
        const items = await adapter.fetch(subscription, host)
        console.log(`  ✅ ${items.length} 条`)
        // 可读摘要:仿 App.tsx 的列表输出。
        for (const it of items.slice(0, 8)) {
          const thumb = it.thumbnail ? " 🖼" : ""
          const when = it.publishedAt ? ` · ${new Date(it.publishedAt).toISOString().slice(0, 10)}` : ""
          console.log(`  - [${it.kind}]${thumb} ${it.title}${when}`)
          if (it.url) console.log(`      ${it.url}`)
        }
        if (items.length > 8) console.log(`  … 其余 ${items.length - 8} 条省略`)
      }
    } catch (err) {
      console.log(`  ❌ 失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

main().catch((err) => {
  console.error("❌ example failed:", err)
  process.exit(1)
})
