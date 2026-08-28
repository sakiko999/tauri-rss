/**
 * align — 收编 core/example/verify-alignment.ts:验证「crawler 输出与 rsshub 对齐」。
 *
 * 断言:同一个 deserializeFeed 对 (a) crawler 自家 serializeFeed XML
 * (b) RSSHub 同构标准 RSS fixture 产出语义一致的 MediaItem;且两者的
 * item.url 都被同一 resolveRoute 路由(resolver 统一生效)。
 *
 * deserializeFeed 不在 core 公共面(收敛内部);CLI 作为 monorepo 内部观测面
 * 走相对路径引用,不发包。
 */
import { serializeFeed } from "@tauri-playground/xml"
import { deserializeFeed } from "../../../../packages/core/src/processing/deserialize.ts"
import { resolveRoute } from "@tauri-playground/resolve"

/** RSSHub 侧标准 RSS 2.0 fixture(与外部实例输出同构,含 media:* 增强)。 */
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

export async function runAlign(): Promise<void> {
  // 1. crawler 自家 XML(serializeFeed → 标准子集 + tpl:)
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
  const fromRsshub = deserializeFeed(rsshubXml(), { subscriptionId: "s-rsshub", now: Date.now() })
  const c0 = fromCrawler[0]!
  const r0 = fromRsshub[0]!

  console.log("crawler XML → deserialize:")
  console.log(`  kind=${c0.kind} title=${c0.title?.slice(0, 24)} thumb=${c0.thumbnail?.slice(0, 30)}`)
  console.log("rsshub XML → deserialize:")
  console.log(`  kind=${r0.kind} title=${r0.title?.slice(0, 24)} thumb=${r0.thumbnail?.slice(0, 30)}`)

  if (c0.kind !== "video") throw new Error(`crawler kind expected video, got ${c0.kind}`)
  if (r0.kind !== "article") throw new Error(`rsshub kind expected article, got ${r0.kind}`)
  if (!c0.thumbnail) throw new Error("crawler thumbnail not parsed")
  if (!r0.thumbnail) throw new Error("rsshub thumbnail (from media:thumbnail) not parsed")

  // 2. resolver 统一路由:两种来源的 item.url 命中同一 resolveRoute
  const crawlerUrl = c0.url
  const rsshubUrl = r0.url
  console.log("resolver 路由:")
  console.log(`  crawler: ${crawlerUrl} → ${JSON.stringify(resolveRoute(crawlerUrl))}`)
  console.log(`  rsshub:  ${rsshubUrl} → ${JSON.stringify(resolveRoute(rsshubUrl))}`)
  if (!crawlerUrl || !resolveRoute(crawlerUrl)) throw new Error("crawler url 未命中 resolver 路由")
  if (!rsshubUrl || !resolveRoute(rsshubUrl)) throw new Error("rsshub url 未命中 resolver 路由")

  console.log("\n✔ 对齐成立:crawler 与 rsshub 输出被同一 deserializeFeed 消费、同一 resolveRoute 路由")
}
