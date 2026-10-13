import { deserializeFeed } from "./packages/core/src/processing/deserialize.ts"

// Universal video-podcast pattern: same URL described by both enclosure and media:content.
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Podcast</title>
    <item>
      <title>Ep 1</title>
      <link>https://example.com/ep1</link>
      <guid isPermaLink="false">ep1</guid>
      <enclosure url="https://cdn.example.com/ep1.mp4" type="video/mp4"/>
      <media:content url="https://cdn.example.com/ep1.mp4" medium="video"/>
    </item>
  </channel>
</rss>`

const [item] = deserializeFeed(xml, { subscriptionId: "s1", now: 0 })
console.log("kind:", item.kind)
console.log("tpl:kind present?", xml.includes("tpl:kind"))
console.log("media:", JSON.stringify(item.media, null, 2))
console.log("media length:", item.media?.length)
