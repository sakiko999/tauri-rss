/**
 * producer 极简 example —— 命令行版"订阅内容输出"。
 *
 * 展示 producer 作为「极简 RSSHub」的核心能力:
 *   fetch(订阅) → FeedItem[] → serializeFeed → RSS 2.0 XML
 * 不依赖 core / Tauri / 浏览器——用 Node 原生 fetch 做 http backend,
 * 纯命令行打印。这也验证重构后 producer 的对外边界:只认订阅、产出 XML。
 *
 * 用法:
 *   bun run scripts/producer-example.ts          # 打印每个订阅的可读摘要
 *   bun run scripts/producer-example.ts --xml    # 打印完整 RSS XML
 *   bun run scripts/producer-example.ts hn       # 只跑指定订阅 id(可用多个)
 */
// 走具体模块导入(与 core-smoke 一致),避免把 producer barrel 里无关面拉进来。
import type { ProducerHost } from "../packages/producer/src/types/producer-host.ts"
import type { FeedItem } from "../packages/producer/src/types/feed-item.ts"
import type { PresetSubscription } from "../packages/producer/src/presets/types.ts"
import { PRESETS, buildPresetSubscription } from "../packages/producer/src/presets/index.ts"
import { registerAllSources } from "../packages/producer/src/source/register-all.ts"
import { registerAllLiveSites } from "../packages/producer/src/live/platforms/index.ts"
import { getSource } from "../packages/producer/src/source/registry.ts"
import { serializeFeed } from "../packages/producer/src/source/feed-serializer.ts"

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

/** 从 presets 选要跑的订阅:给了 id 就只跑那几条,否则全跑。 */
function pickPresets(): PresetSubscription[] {
  if (!only.length) return [...PRESETS]
  const picked = only
    .map((id) => PRESETS.find((p) => p.id === id))
    .filter((p): p is PresetSubscription => p !== undefined)
  if (!picked.length) {
    console.error(`没有匹配的订阅 id。可用: ${PRESETS.map((p) => p.id).join(" / ")}`)
    process.exit(1)
  }
  return picked
}

async function main() {
  const host = nodeHost()
  registerAllSources()
  registerAllLiveSites(host)

  const presets = pickPresets()

  for (const preset of presets) {
    console.log(`\n═══ ${preset.title} (kind: ${preset.kind}) ═══`)
    const sub = buildPresetSubscription(preset, { enabled: true, createdAt: Date.now(), updatedAt: Date.now() })
    const adapter = getSource(sub.kind)
    if (!adapter) {
      console.log(`  ⚠️ 无 adapter(未注册 kind: ${sub.kind})`)
      continue
    }
    try {
      const items: FeedItem[] = await adapter.fetch(sub, host)
      console.log(`  ✅ ${items.length} 条`)

      if (wantXml) {
        console.log(serializeFeed(items, { channelTitle: preset.title, channelLink: "https://tauri-playground.local/feeds/" + preset.id }))
      } else {
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
