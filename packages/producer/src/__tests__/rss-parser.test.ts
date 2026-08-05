import { test, expect, describe } from "bun:test"
import { parseFeed } from "../source/rss/xml-parser.ts"
import { feedToArticles } from "../source/rss/rss-to-items.ts"

describe("parseFeed", () => {
  test("RSS 2.0: maps channel + items", () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0">
        <channel>
          <title>Example Blog</title>
          <link>https://example.com</link>
          <description>A blog</description>
          <item>
            <title>First Post</title>
            <link>https://example.com/1</link>
            <description>A summary</description>
            <pubDate>Wed, 15 Jan 2025 10:00:00 GMT</pubDate>
            <guid>https://example.com/1</guid>
            <author>Alice</author>
          </item>
        </channel>
      </rss>`
    const feed = parseFeed(xml)
    expect(feed.channel.title).toBe("Example Blog")
    expect(feed.channel.link).toBe("https://example.com")
    expect(feed.channel.item).toHaveLength(1)
    const it = feed.channel.item[0]!
    expect(it.title).toBe("First Post")
    expect(it.link).toBe("https://example.com/1")
    expect(it.description).toBe("A summary")
    expect(it.author).toBe("Alice")
    expect(it.guid).toBe("https://example.com/1")
  })

  test("Atom: normalizes entry/link-href/@_href fix", () => {
    // Atom stores the URL in a link/@href attribute. With attributeNamePrefix
    // "@_", the parser yields @_href — this exercises the fixed branch that the
    // old rss-reader code got wrong (it read .href).
    const xml = `<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>Atom Feed</title>
        <link href="https://atom.example.com"/>
        <subtitle>sub</subtitle>
        <entry>
          <title>An Entry</title>
          <link href="https://atom.example.com/e1"/>
          <summary>entry summary</summary>
          <published>2025-02-01T00:00:00Z</published>
          <author><name>Bob</name></author>
          <id>tag:atom.example.com,2025:e1</id>
        </entry>
      </feed>`
    const feed = parseFeed(xml)
    expect(feed.channel.title).toBe("Atom Feed")
    // Channel link from @_href attribute
    expect(feed.channel.link).toBe("https://atom.example.com")
    const it = feed.channel.item[0]!
    expect(it.title).toBe("An Entry")
    // The headline fix: entry link resolved from @_href, not lost
    expect(it.link).toBe("https://atom.example.com/e1")
    expect(it.author).toBe("Bob")
    expect(it.guid).toBe("tag:atom.example.com,2025:e1")
  })

  test("Atom: typed/CDATA fields render their text (regression)", () => {
    // Real-world Atom (WordPress/Verge style): <title type="html"><![CDATA[...]]></title>,
    // <content type="html"><![CDATA[...]]></content>. fast-xml-parser yields these as
    // { "#text": "...", "@_type": "html" } objects, NOT plain strings. asString() must
    // dig the #text out, else title/content silently drop to undefined.
    const xml = `<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title type="text"><![CDATA[The Verge]]></title>
        <link href="https://www.theverge.com"/>
        <entry>
          <title type="html"><![CDATA[Xbox prices are going up]]></title>
          <link rel="alternate" type="text/html" href="https://www.theverge.com/1"/>
          <summary type="html"><![CDATA[A short summary]]></summary>
          <content type="html"><![CDATA[<p>full body</p>]]></content>
          <published>2025-03-01T00:00:00Z</published>
          <id>https://www.theverge.com/?p=1</id>
        </entry>
      </feed>`
    const feed = parseFeed(xml)
    expect(feed.channel.title).toBe("The Verge")
    const it = feed.channel.item[0]!
    expect(it.title).toBe("Xbox prices are going up")
    expect(it.description).toBe("A short summary")
    expect(it.content).toBe("<p>full body</p>")
    expect(it.link).toBe("https://www.theverge.com/1")
    expect(it.guid).toBe("https://www.theverge.com/?p=1")
  })

  test("single-item feed (not wrapped in array) still arrayed", () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>S</title>
      <item><title>only</title></item></channel></rss>`
    expect(parseFeed(xml).channel.item).toHaveLength(1)
  })
})

describe("feedToArticles", () => {
  test("maps to ArticleItem with epoch publishedAt + html format", () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Blog</title>
      <item>
        <title>T</title>
        <link>https://x/y</link>
        <description>sum</description>
        <content:encoded><![CDATA[<p>body</p>]]></content:encoded>
        <pubDate>Wed, 15 Jan 2025 10:00:00 GMT</pubDate>
        <guid>g1</guid>
      </item></channel></rss>`
    const feed = parseFeed(xml)
    const items = feedToArticles(feed, {

      sourceId: "rss",
      fetchedAt: 1_700_000_000_000,
      feedTitle: "Blog",
    })
    expect(items).toHaveLength(1)
    const a = items[0]!
    expect(a.kind).toBe("article")
    expect(a.id).toBe("g1")
    expect(a.content).toContain("<p>body</p>")
    expect(a.contentFormat).toBe("html")
    expect(a.publishedAt).toBe(new Date("Wed, 15 Jan 2025 10:00:00 GMT").getTime())
    expect(a.author?.name).toBe("Blog")
  })

  test("falls back to url hash id when guid missing", () => {
    const feed = parseFeed(
      `<?xml version="1.0"?><rss version="2.0"><channel><item><title>NoGuid</title><link>https://x/1</link></item></channel></rss>`,
    )
    const items = feedToArticles(feed, {

      sourceId: "rss",
      fetchedAt: 0,
    })
    expect(items[0]!.id).toMatch(/^hash-/)
  })
})
