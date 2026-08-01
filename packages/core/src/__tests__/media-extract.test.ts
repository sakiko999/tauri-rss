/**
 * Media extraction + classifier tests — the new layer that pulls
 * enclosure/media:content/itunes attachments into `ArticleItem.media[]`
 * and classifies an item's primary `Content` kind.
 */
import { test, expect, describe } from "bun:test"
import { parseFeed } from "../source/rss/xml-parser.ts"
import { feedToArticles } from "../source/rss/rss-to-items.ts"
import { inferContent } from "../content/classifier.ts"

describe("extractMedia", () => {
  test("RSS 2.0 <enclosure> → video attachment", () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Pod</title>
      <item>
        <title>Episode 1</title>
        <link>https://x/1</link>
        <enclosure url="https://x/video.mp4" type="video/mp4" length="12345"/>
      </item></channel></rss>`
    const feed = parseFeed(xml)
    const items = feedToArticles(feed, { subscriptionId: "s", sourceId: "rss", fetchedAt: 0 })
    expect(items[0]!.media).toHaveLength(1)
    const m = items[0]!.media![0]!
    expect(m.kind).toBe("video")
    expect(m.url).toBe("https://x/video.mp4")
    expect(m.mimeType).toBe("video/mp4")
    expect(m.streamingFormat).toBe("progressive")
  })

  test("itunes:image + itunes:duration → audio attachment with duration", () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Pod</title>
      <item>
        <title>Ep</title>
        <enclosure url="https://x/a.mp3" type="audio/mpeg" length="100"/>
        <itunes:image href="https://x/cover.jpg"/>
        <itunes:duration>12:34</itunes:duration>
      </item></channel></rss>`
    const feed = parseFeed(xml)
    const items = feedToArticles(feed, { subscriptionId: "s", sourceId: "rss", fetchedAt: 0 })
    const media = items[0]!.media!
    // audio enclosure + itunes image
    expect(media.length).toBeGreaterThanOrEqual(2)
    const audio = media.find((m) => m.kind === "audio")!
    expect(audio.url).toBe("https://x/a.mp3")
    expect(audio.durationSec).toBe(12 * 60 + 34)
    expect(media.some((m) => m.kind === "image" && m.url === "https://x/cover.jpg")).toBe(true)
  })

  test("media:content with width/height → aspectRatio computed", () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>M</title>
      <item>
        <title>T</title>
        <media:content url="https://x/pic.jpg" type="image/jpeg" width="800" height="400"/>
      </item></channel></rss>`
    const feed = parseFeed(xml)
    const items = feedToArticles(feed, { subscriptionId: "s", sourceId: "rss", fetchedAt: 0 })
    const media = items[0]!.media!
    const img = media.find((m) => m.kind === "image")!
    expect(img.width).toBe(800)
    expect(img.height).toBe(400)
    expect(img.aspectRatio).toBe(2)
  })

  test("Atom link rel=enclosure → video attachment", () => {
    const xml = `<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>A</title>
        <entry>
          <title>E</title>
          <link href="https://a.example.com/e1"/>
          <link rel="enclosure" href="https://a.example.com/v.m4v" type="video/x-m4v" length="999"/>
        </entry>
      </feed>`
    const feed = parseFeed(xml)
    const items = feedToArticles(feed, { subscriptionId: "s", sourceId: "rss", fetchedAt: 0 })
    const media = items[0]!.media!
    expect(media).toHaveLength(1)
    expect(media[0]!.kind).toBe("video")
    expect(media[0]!.url).toBe("https://a.example.com/v.m4v")
  })

  test("dedupes identical attachments", () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>M</title>
      <item>
        <title>T</title>
        <enclosure url="https://x/a.mp3" type="audio/mpeg"/>
        <enclosure url="https://x/a.mp3" type="audio/mpeg"/>
      </item></channel></rss>`
    const feed = parseFeed(xml)
    const items = feedToArticles(feed, { subscriptionId: "s", sourceId: "rss", fetchedAt: 0 })
    expect(items[0]!.media).toHaveLength(1)
  })
})

describe("inferContent", () => {
  test("thin-body + video → video content", () => {
    const item = {
      id: "1",
      subscriptionId: "s",
      sourceId: "rss",
      kind: "article" as const,
      title: "V",
      fetchedAt: 0,
      media: [{ kind: "video" as const, url: "https://x/v.mp4" }],
    }
    const c = inferContent(item)
    expect(c.kind).toBe("video")
    if (c.kind === "video") expect(c.video.url).toBe("https://x/v.mp4")
  })

  test("substantial text body wins → article content", () => {
    const item = {
      id: "1",
      subscriptionId: "s",
      sourceId: "rss",
      kind: "article" as const,
      title: "A",
      fetchedAt: 0,
      content: "x".repeat(300),
      media: [{ kind: "video" as const, url: "https://x/v.mp4" }],
    }
    const c = inferContent(item)
    expect(c.kind).toBe("article")
  })

  test("no media → article content", () => {
    const item = {
      id: "1",
      subscriptionId: "s",
      sourceId: "rss",
      kind: "article" as const,
      title: "A",
      fetchedAt: 0,
    }
    expect(inferContent(item).kind).toBe("article")
  })
})
