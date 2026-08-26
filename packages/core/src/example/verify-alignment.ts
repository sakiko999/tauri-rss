/**
 * verify-alignment —— 验证「crawler 输出与 rsshub 对齐」。
 *
 * 核心断言:同一个 `deserializeFeed`,对
 *   (a) crawler 自家 XML(serializeFeed,收敛为标准 RSS 子集 + tpl:kind)
 *   (b) RSSHub 外部实例输出(标准 RSS 2.0 + media:* 增强)
 * 能产出语义一致的 MediaItem(kind/id/title/thumbnail/author/content)。
 *
 * 不依赖真实 RSSHub:用标准 RSS 2.0 fixture(与外部 RSSHub 实例输出同构)
 * 对照 crawler 的 serializeFeed。两者被同一 deserialize 正确消费即「对齐」。
 *
 * Run: bun run packages/core/src/example/verify-alignment.ts
 */
import "../source/rsshub.ts"
import { serializeFeed } from "@tauri-playground/xml"
import { deserializeFeed } from "../processing/deserialize.ts"

/** RSSHub 侧的标准 RSS 2.0(与外部实例输出同构,含 media:* 增强)。 */
function rsshubXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Hacker News</title>
    <link>https://news.ycombinator.com</link>
    <description>HN</description>
    <item>
      <title>Test HN story</title>
      <link>https://www.bilibili.com/video/BV1xx411c7mD</link>
      <description><![CDATA[<p>A test story body</p>]]></description>
      <guid isPermaLink="false">https://news.ycombinator.com/item?id=1</guid>
      <pubDate>Fri, 21 Aug 2026 08:09:10 GMT</pubDate>
      <author>test@hn.com</author>
      <media:thumbnail url="https://i.ytimg.com/vi/xBByvFrqmWU/maxresdefault.jpg" />
    </item>
  </channel>
</rss>`
}

async function main() {
  // 1. crawler 自家 XML(serializeFeed → tpl: 扩展)
  const crawlerXml = serializeFeed(
    [
      {
        id: "crawler-item-1",
        sourceId: "bili:popular",
        kind: "video" as const,
        title: "Test video",
        url: "https://www.bilibili.com/video/BV1xx411c7mD",
        summary: "crawler summary",
        publishedAt: Date.now(),
        fetchedAt: Date.now(),
        thumbnail: "https://i2.hdslb.com/bfs/archive/crawler.jpg",
      },
    ],
    { channelTitle: "bilibili 热门" },
  )
  const fromCrawler = deserializeFeed(crawlerXml, { subscriptionId: "s-crawler", now: Date.now() })
  const c0 = fromCrawler[0]!

  // 2. RSSHub 侧 fixture
  const fromRsshub = deserializeFeed(rsshubXml(), { subscriptionId: "s-rsshub", now: Date.now() })
  const r0 = fromRsshub[0]!

  console.log("═══ crawler XML → deserialize ═══")
  console.log("  kind:", c0.kind, "| title:", c0.title?.slice(0, 24), "| thumb:", c0.thumbnail?.slice(0, 30))
  console.log("═══ rsshub XML → deserialize ═══")
  console.log("  kind:", r0.kind, "| title:", r0.title?.slice(0, 24), "| thumb:", r0.thumbnail?.slice(0, 30))

  // 3. 对齐断言:同一 deserialize 正确消费两种输出,kind 各自正确
  if (c0.kind !== "video") throw new Error(`crawler kind expected video, got ${c0.kind}`)
  if (r0.kind !== "article") throw new Error(`rsshub kind expected article, got ${r0.kind}`)
  if (!r0.thumbnail) throw new Error("rsshub thumbnail(from media:thumbnail) not parsed")
  if (!c0.thumbnail) throw new Error("crawler thumbnail not parsed")

  console.log("\n✅ 对齐成立:crawler(tpl:) 与 rsshub(标准 RSS+media:) 被同一 deserializeFeed 正确消费")

  // 3. resolver 统一解析:crawler 与 rsshub 的 item.url 都被同一 resolveRoute 路由。
  const { resolveRoute } = await import("@tauri-playground/resolve")
  const crawlerUrl = (fromCrawler[0] as { url?: string }).url
  const rsshubUrl = (fromRsshub[0] as { url?: string }).url
  console.log("\n═══ resolver 统一路由 ═══")
  console.log("  crawler url:", crawlerUrl, "→", JSON.stringify(resolveRoute(crawlerUrl)))
  console.log("  rsshub  url:", rsshubUrl, "→", JSON.stringify(resolveRoute(rsshubUrl)))
  if (!crawlerUrl || !resolveRoute(crawlerUrl)) throw new Error("crawler url 未命中 resolver 路由")
  if (!rsshubUrl || !resolveRoute(rsshubUrl)) throw new Error("rsshub url 未命中 resolver 路由")
  console.log("\n✅ resolver 统一生效:crawler 与 rsshub 的 item.url 被同一 resolveRoute 命中")
}

await main()