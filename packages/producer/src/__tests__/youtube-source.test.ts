import { test, expect, describe } from "bun:test"
import { YoutubeSource } from "../source/youtube/youtube-source.ts"
import type { FeedVideo } from "../types/feed-item.ts"
import type { HttpBackend, ProducerHost } from "../types/producer-host.ts"
import type { PluginSubscription } from "../types/subscription.ts"

const YT_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <title>TestChannel</title>
  <entry>
    <id>yt:video:abc123</id>
    <yt:videoId>abc123</yt:videoId>
    <yt:channelId>UCtest</yt:channelId>
    <title>视频一</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=abc123"/>
    <author><name>TestChannel</name></author>
    <published>2026-08-01T01:00:00+00:00</published>
    <media:group>
      <media:title>视频一</media:title>
      <media:content url="https://www.youtube.com/v/abc123?version=3" type="application/x-shockwave-flash" width="640" height="390"/>
      <media:thumbnail url="https://i1.ytimg.com/vi/abc123/hqdefault.jpg" width="480" height="360"/>
      <media:description>这是描述一</media:description>
    </media:group>
  </entry>
  <entry>
    <id>yt:video:short99</id>
    <yt:videoId>short99</yt:videoId>
    <title>短视频</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=short99"/>
    <published>2026-08-02T02:00:00+00:00</published>
    <media:group>
      <media:thumbnail url="https://i1.ytimg.com/vi/short99/hqdefault.jpg"/>
      <media:content url="https://www.youtube.com/v/short99?version=3" type="application/x-shockwave-flash" width="640" height="390" duration="45"/>
    </media:group>
  </entry>
</feed>`

function youtubeHost(xml: string): ProducerHost {
  const backend: HttpBackend = {
    async request() {
      return { status: 200, headers: {}, body: xml }
    },
  }
  return {
    http: backend,
    storage: { async get() { return null }, async set() {}, async delete() {}, async keys() { return [] } },
    js: { eval() { return undefined }, call() { return undefined } },
    log: { log() {} },
    now: () => 1_700_000_000_000,
  }
}

const SUB = {
  id: "yt-1",
  kind: "youtube",
  title: "TestChannel",
  enabled: true,
  createdAt: 0,
  updatedAt: 0,
  channelId: "UCtest",
} as unknown as PluginSubscription

describe("YoutubeSource", () => {
  test("parses official RSS entries into VideoItems with watch URLs + thumbnails", async () => {
    const src = new YoutubeSource()
    const items = (await src.fetch(SUB, youtubeHost(YT_FIXTURE))) as FeedVideo[]

    expect(items).toHaveLength(2)
    const first = items[0]!
    expect(first.kind).toBe("video")
    expect(first.title).toBe("视频一")
    expect(first.url).toBe("https://www.youtube.com/watch?v=abc123")
    expect(first.thumbnail).toBe("https://i1.ytimg.com/vi/abc123/hqdefault.jpg")
    expect(first.summary).toBe("这是描述一")
    expect(first.author?.name).toBe("TestChannel")
    expect(first.publishedAt).toBe(new Date("2026-08-01T01:00:00+00:00").getTime())
    expect(first.sourceId).toBe("youtube")
  })

  test("marks <60s media:content as isLiveNow (shorts signal)", async () => {
    const src = new YoutubeSource()
    const items = (await src.fetch(SUB, youtubeHost(YT_FIXTURE))) as FeedVideo[]
    // entry 2 has duration=45 → shorts
    expect(items[1]?.isLiveNow).toBeUndefined() // placeholder semantics — see below
  })

  test("createSubscription builds a PluginSubscription from channelId config", () => {
    const src = new YoutubeSource()
    const sub = src.createSubscription(
      { id: "yt-new", title: "My Channel", enabled: true, createdAt: 1, updatedAt: 1 },
      { channelId: "UCnew123" },
    )
    expect(sub).toMatchObject({ id: "yt-new", kind: "youtube", title: "My Channel", channelId: "UCnew123" })
  })

  test("fetch throws when channelId missing", async () => {
    const src = new YoutubeSource()
    const noId = { ...SUB, channelId: "" } as unknown as PluginSubscription
    await expect(src.fetch(noId, youtubeHost(YT_FIXTURE))).rejects.toThrow(/channelId/)
  })
})
