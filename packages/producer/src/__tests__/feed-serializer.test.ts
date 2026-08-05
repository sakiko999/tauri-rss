import { test, expect, describe } from "bun:test"
import { XMLParser } from "fast-xml-parser"
import { serializeFeed } from "../source/feed-serializer.ts"
import { deserializeFeed } from "../source/feed-deserializer.ts"
import type { FeedArticle, FeedAudio, FeedLive, FeedSocial, FeedVideo } from "../types/feed-item.ts"

/** A standard reader — bare fast-xml-parser with the same config the codebase uses. */
const standard = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" })

const BASE = {
  sourceId: "rss",
  fetchedAt: 1_754_406_000_000,
  isUnread: true,
}

describe("serializeFeed → standard-reader readability", () => {
  test("a standard parser reads the standard subset without tpl:", () => {
    const article: FeedArticle = {
      ...BASE,
      id: "theverge-1",
      kind: "article",
      title: "Xbox 价格上调",
      url: "https://theverge.com/1",
      summary: "一段摘要",
      content: "<p>全文</p>",
      contentFormat: "html",
      publishedAt: 1_754_400_000_000,
      author: { name: "Tom Warren" },
      media: [{ kind: "video", url: "https://cdn/v.mp4", mimeType: "video/mp4", durationSec: 12 }],
    }
    const xml = serializeFeed([article], {
      channelTitle: "The Verge",
      channelLink: "https://www.theverge.com",
      channelDescription: "科技新闻",
    })
    expect(xml).toContain('xmlns:tpl="https://tauri-playground.local/ns/tpl"')
    expect(xml).toContain('xmlns:content="http://purl.org/rss/1.0/modules/content/"')

    const parsed = standard.parse(xml) as any
    const channel = parsed.rss.channel
    expect(channel.title).toBe("The Verge")
    expect(channel.link).toBe("https://www.theverge.com")
    expect(channel.description).toBe("科技新闻")
    const item = channel.item
    expect(item.title).toBe("Xbox 价格上调")
    expect(item.link).toBe("https://theverge.com/1")
    expect(item.guid["@_isPermaLink"]).toBe("false")
    expect(item.guid["#text"]).toBe("theverge-1")
    expect(item.author).toBe("Tom Warren")
    expect(item["content:encoded"]).toContain("<p>全文</p>")
    expect(item.enclosure["@_url"]).toBe("https://cdn/v.mp4")
    expect(item.enclosure["@_type"]).toBe("video/mp4")
    // 标准解析器看到 tpl:kind 但不需要它就能拿到上面的标准字段
    expect(item["tpl:kind"]).toBe("article")
  })
})

describe("round-trip fidelity", () => {
  test("article with media[] round-trips losslessly (raw dropped)", () => {
    const article: FeedArticle = {
      ...BASE,
      id: "hash-abc123",
      kind: "article",
      title: "标题 & 更多 <内容>",
      url: "https://example.com/a?x=1&y=2",
      summary: "摘要</CDATA>\]\]>边缘",
      content: "<p>含 &amp; &lt; &gt; 的正文]]></p>",
      contentFormat: "html",
      publishedAt: 1_754_400_000_000,
      author: { name: "作者", avatar: "https://avatar" },
      thumbnail: "https://thumb.jpg",
      media: [
        { kind: "image", url: "https://img/1.jpg", width: 800, height: 450, aspectRatio: 800 / 450 },
        { kind: "video", url: "https://cdn/v.mp4", mimeType: "video/mp4", streamingFormat: "progressive", durationSec: 12 },
      ],
      raw: { something: "opaque" },
    }
    const xml = serializeFeed([article])
    const [back] = deserializeFeed(xml) as FeedArticle[]
    expect(back).toMatchObject({
      id: article.id,
      sourceId: article.sourceId,
      kind: "article",
      title: article.title,
      url: article.url,
      summary: article.summary,
      content: article.content,
      contentFormat: "html",
      publishedAt: article.publishedAt,
      fetchedAt: article.fetchedAt,
      isUnread: true,
    })
    expect(back.author).toEqual(article.author)
    expect(back.thumbnail).toBe(article.thumbnail)
    expect(back.media).toEqual(article.media)
    // 不变量:raw 不序列化(刻意丢弃)
    expect(back.raw).toBeUndefined()
  })

  test("live item with multi-quality playUrls round-trips exactly", () => {
    const live: FeedLive = {
      ...BASE,
      id: "bilibili:123456",
      sourceId: "live:bilibili",
      kind: "live",
      title: "崩坏3 前瞻直播",
      url: "https://live.bilibili.com/123456",
      summary: "今日 19:00 前瞻",
      thumbnail: "https://i0.hdslb.com/cover.jpg",
      author: { name: "米忽悠", avatar: "https://avatar" },
      platform: "bilibili",
      roomId: "123456",
      liveStatus: "live",
      online: 12834,
      isRecord: false,
      showTime: "2026-08-05T19:00:00+08:00",
      playUrls: ["https://live.m3u8", "https://live.flv"],
      playHeaders: { Referer: "https://live.bilibili.com", "User-Agent": "Mozilla/5.0" },
      quality: "原画",
      playUrlsExpiresAt: 1_754_409_600_000,
    }
    const xml = serializeFeed([live])
    expect(xml).toContain("<tpl:playUrls")
    const [back] = deserializeFeed(xml) as FeedLive[]
    expect(back).toMatchObject({
      id: live.id,
      sourceId: "live:bilibili",
      kind: "live",
      title: live.title,
      url: live.url,
      platform: "bilibili",
      roomId: "123456",
      liveStatus: "live",
      online: 12834,
      isRecord: false,
      showTime: live.showTime,
      playUrls: live.playUrls,
      playHeaders: live.playHeaders,
      quality: "原画",
      playUrlsExpiresAt: 1_754_409_600_000,
    })
    expect(back.author).toEqual(live.author)
    expect(back.thumbnail).toBe(live.thumbnail)
  })

  test("tpl fields (streamingFormat/durationSec/isUnread) survive", () => {
    const video: FeedVideo = {
      ...BASE,
      id: "yt-1",
      kind: "video",
      title: "3Blue1Brown 新视频",
      url: "https://youtu.be/abc",
      streamingFormat: "hls",
      durationSec: 730,
      duration: 730,
      stream: { url: "https://cdn/hls/master.m3u8", format: "hls", headers: { Referer: "https://youtube.com" } },
      channel: { name: "3Blue1Brown", avatar: "https://avatar" },
      isLiveNow: false,
    }
    const xml = serializeFeed([video])
    expect(xml).toContain("<tpl:streamingFormat>hls</tpl:streamingFormat>")
    expect(xml).toContain("<tpl:durationSec>730</tpl:durationSec>")
    expect(xml).toContain("<tpl:isUnread>1</tpl:isUnread>")
    const [back] = deserializeFeed(xml) as FeedVideo[]
    expect(back.streamingFormat).toBe("hls")
    expect(back.durationSec).toBe(730)
    expect(back.isUnread).toBe(true)
    expect(back.stream).toEqual(video.stream)
    expect(back.channel).toEqual(video.channel)
  })

  test("social round-trips reactions + images", () => {
    const social: FeedSocial = {
      ...BASE,
      id: "tweet-1",
      kind: "social",
      title: "一个帖子",
      content: "大家好",
      images: ["https://img/1.jpg", "https://img/2.jpg"],
      likes: 12,
      reposts: 3,
      replies: 7,
      isLiked: true,
    }
    const [back] = deserializeFeed(serializeFeed([social])) as FeedSocial[]
    expect(back).toMatchObject({
      kind: "social",
      content: "大家好",
      images: ["https://img/1.jpg", "https://img/2.jpg"],
      likes: 12,
      reposts: 3,
      replies: 7,
      isLiked: true,
    })
  })

  test("audio round-trips artist/album/stream", () => {
    const audio: FeedAudio = {
      ...BASE,
      id: "pod-1",
      kind: "audio",
      title: "Huberman Lab #1",
      duration: 5400,
      artist: "Andrew Huberman",
      album: "Huberman Lab",
      stream: { url: "https://cdn/pod.mp3", format: "progressive" },
    }
    const [back] = deserializeFeed(serializeFeed([audio])) as FeedAudio[]
    expect(back).toMatchObject({
      kind: "audio",
      duration: 5400,
      artist: "Andrew Huberman",
      album: "Huberman Lab",
      stream: { url: "https://cdn/pod.mp3", format: "progressive" },
    })
  })

  test("empty items serialize to a valid empty channel", () => {
    const xml = serializeFeed([])
    expect(xml).toContain("<channel></channel>")
    expect(deserializeFeed(xml)).toEqual([])
  })
})
