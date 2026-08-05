import { test, expect, describe } from "bun:test"
import { deserializeFeed } from "../source/feed-deserializer.ts"
import type { FeedArticle, FeedLive } from "../types/feed-item.ts"

describe("deserializeFeed — foreign feed (no tpl:)", () => {
  test("a plain RSS article with no tpl fields degrades to a default FeedArticle", () => {
    const xml = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>示例博客</title>
  <item>
    <title>一篇文章</title>
    <link>https://example.com/post/1</link>
    <description>简介</description>
    <guid>post-1</guid>
    <pubDate>Wed, 05 Aug 2026 10:00:00 GMT</pubDate>
    <author>张三</author>
  </item>
</channel></rss>`
    const [item] = deserializeFeed(xml) as FeedArticle[]
    expect(item.kind).toBe("article")
    expect(item.id).toBe("post-1")
    expect(item.title).toBe("一篇文章")
    expect(item.url).toBe("https://example.com/post/1")
    expect(item.summary).toBe("简介")
    expect(item.content).toBe("简介")
    expect(item.author?.name).toBe("张三")
    expect(item.fetchedAt).toBeGreaterThan(0)
    // tpl 缺省:isUnread/isStarred 保持协议可空(不默认)——core 桥补默认。
    expect(item.isUnread).toBeUndefined()
    expect(item.isStarred).toBeUndefined()
  })
})

describe("tpl:kind dispatch", () => {
  test("routes each kind to the correct branch", () => {
    const xml = `<?xml version="1.0"?>
<rss version="2.0"><channel>
${item("live", "live-stream-1")}
${item("video", "video-1")}
${item("audio", "audio-1")}
${item("social", "social-1")}
</channel></rss>`
    const kinds = deserializeFeed(xml).map((i) => i.kind)
    expect(kinds).toEqual(["live", "video", "audio", "social"])
  })

  test("liveWithNoTpl has defaults, and live without playUrls reports unknown/empty", () => {
    const xml = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>离线房间</title>
    <guid>live:douyu:42</guid>
    <tpl:kind>live</tpl:kind>
    <tpl:platform>douyu</tpl:platform>
    <tpl:roomId>42</tpl:roomId>
    <tpl:liveStatus>offline</tpl:liveStatus>
  </item>
</channel></rss>`
    const [item] = deserializeFeed(xml) as FeedLive[]
    expect(item.kind).toBe("live")
    expect(item.platform).toBe("douyu")
    expect(item.roomId).toBe("42")
    expect(item.liveStatus).toBe("offline")
    expect(item.playUrls).toBeUndefined()
    expect(item.playUrlsExpiresAt).toBeUndefined()
  })
})

function item(kind: string, id: string): string {
  return `<item>
    <title>${kind} 条目</title>
    <guid>${id}</guid>
    <tpl:kind>${kind}</tpl:kind>
  </item>`
}