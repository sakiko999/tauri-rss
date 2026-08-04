/**
 * Core media smoke — verifies `createDataLayer` + RSS refresh + media
 * extraction end-to-end against a local fixture (no network).
 *
 * Run: `bun run scripts/core-smoke.ts`
 */
// 故意不走 barrel：barrel 会 re-export browser-host（依赖 DOM 全局），
// 而这个脚本自建 fixture host，只需 data-layer 与纯类型。走具体模块导入，
// 让 scripts 项目（纯 node tsconfig）不把 DOM 库拖进来。
import { createDataLayer } from "../packages/core/src/data-layer.ts"
import type { ArticleItem } from "../packages/producer/src/types/media-item.ts"
import type {
  HttpBackend,
  HttpResponse,
  PlatformHost,
} from "../packages/core/src/types/platform.ts"

/** A fixture RSS feed with media: a video enclosure + an image. */
const FIXTURE_XML = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Fixture Feed</title>
    <link>https://fixture.example</link>
    <description>A fixture</description>
    <item>
      <title>Post with media</title>
      <link>https://fixture.example/1</link>
      <description>Short body</description>
      <guid>g1</guid>
      <enclosure url="https://fixture.example/v.mp4" type="video/mp4" length="12345"/>
      <media:thumbnail url="https://fixture.example/t.jpg"/>
    </item>
    <item>
      <title>Plain post</title>
      <link>https://fixture.example/2</link>
      <guid>g2</guid>
    </item>
  </channel>
</rss>`

/** A host whose http backend always returns the fixture (CORS-less stand-in). */
function fixtureHost(): PlatformHost {
  const http: HttpBackend = {
    async request(): Promise<HttpResponse> {
      return { status: 200, headers: {}, body: FIXTURE_XML }
    },
  }
  const mem = new Map<string, string>()
  return {
    http,
    storage: {
      async get(k) { return mem.get(k) ?? null },
      async set(k, v) { mem.set(k, v) },
      async delete(k) { mem.delete(k) },
      async keys() { return [...mem.keys()] },
    },
    js: { eval() { return undefined }, call() { return undefined } },
    log: { log() {} },
    now: () => 1_700_000_000_000,
  }
}

async function main() {
  const dl = createDataLayer(fixtureHost())

  await dl.subscriptions.add({
    id: "fixture",
    kind: "rss",
    title: "Fixture",
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    url: "https://fixture.example/feed.xml",
  })

  const res = await dl.refresh("fixture")
  if (res.error) {
    console.error("❌ refresh error:", res.error)
    process.exit(1)
  }

  const items = dl.store.query({ subscriptionId: "fixture" })
  console.log(`\nrefreshed ${res.itemCount} items`)
  for (const it of items) {
    console.log(`  - [${it.kind}] ${it.title}`)
    if (it.kind === "article") {
      const art = it as ArticleItem
      for (const m of art.media ?? []) {
        console.log(`      media: ${m.kind} ${m.url}${m.streamingFormat ? ` (${m.streamingFormat})` : ""}`)
      }
    }
  }

  const first = items.find((i) => i.kind === "article") as ArticleItem | undefined
  if (!first?.media?.length) {
    console.error("❌ no media extracted")
    process.exit(1)
  }
  const hasVideo = first.media.some((m) => m.kind === "video")
  const hasImage = first.media.some((m) => m.kind === "image")
  if (!hasVideo || !hasImage) {
    console.error("❌ expected video + image attachments, got:", JSON.stringify(first.media))
    process.exit(1)
  }
  console.log("\n✅ media extraction OK (video + image attachments)")
}

main().catch((err) => {
  console.error("❌ smoke failed:", err)
  process.exit(1)
})
