import { test, expect, describe } from "bun:test"
import { feedItemsToMediaItems } from "../feed-to-media.ts"
import type { FeedArticle, FeedLive, FeedVideo } from "@tauri-playground/producer"

describe("feedItemsToMediaItems — producer FeedItem → core MediaItem bridge", () => {
  test("injects subscriptionId + defaults (isUnread true / isStarred false) into an article", () => {
    const feed: FeedArticle = {
      id: "a1",
      sourceId: "rss",
      kind: "article",
      title: "一篇文章",
      url: "https://x/1",
      summary: "简介",
      content: "<p>正文</p>",
      contentFormat: "html",
      author: { name: "作者" },
      publishedAt: 1_700_000_000_000,
      fetchedAt: 1_700_000_100_000,
      media: [{ kind: "image", url: "https://x/t.jpg" }],
    }
    const [item] = feedItemsToMediaItems([feed], { subscriptionId: "sub-1", now: 2_000_000_000_000 })
    expect(item).toMatchObject({
      id: "a1",
      subscriptionId: "sub-1",
      sourceId: "rss",
      kind: "article",
      title: "一篇文章",
      url: "https://x/1",
      content: "<p>正文</p>",
      contentFormat: "html",
      publishedAt: 1_700_000_000_000,
      isUnread: true, // 默认
      isStarred: false, // 默认
      media: [{ kind: "image", url: "https://x/t.jpg" }],
    })
    expect(item.fetchedAt).toBe(1_700_000_100_000) // 有值用原值
  })

  test("preserves fetchedAt (protocol requires it) + raw passthrough", () => {
    const feed: FeedArticle = {
      id: "a2",
      sourceId: "rss",
      kind: "article",
      title: "有时间",
      fetchedAt: 0, // 合法值,0 不该被 now 覆盖
      raw: { opaque: true },
    }
    const [item] = feedItemsToMediaItems([feed], { subscriptionId: "s", now: 5_000_000_000_000 })
    expect(item.fetchedAt).toBe(0)
    expect(item.raw).toEqual({ opaque: true })
  })

  test("isUnread/isStarred explicit values pass through (not overwritten by defaults)", () => {
    const feed: FeedArticle = {
      id: "a3",
      sourceId: "rss",
      kind: "article",
      title: "已读",
      fetchedAt: 0,
      isUnread: false,
      isStarred: true,
    }
    const [item] = feedItemsToMediaItems([feed], { subscriptionId: "s", now: 0 })
    expect(item.isUnread).toBe(false)
    expect(item.isStarred).toBe(true)
  })

  test("video variant keeps stream + channel", () => {
    const feed: FeedVideo = {
      id: "v1",
      sourceId: "youtube",
      kind: "video",
      title: "视频",
      fetchedAt: 0,
      duration: 730,
      stream: { url: "https://cdn/hls.m3u8", format: "hls", headers: { Referer: "https://youtube.com" } },
      channel: { name: "3Blue1Brown" },
    }
    const [item] = feedItemsToMediaItems([feed], { subscriptionId: "s", now: 0 })
    expect(item).toMatchObject({
      kind: "video",
      duration: 730,
      stream: { url: "https://cdn/hls.m3u8", format: "hls", headers: { Referer: "https://youtube.com" } },
      channel: { name: "3Blue1Brown" },
    })
  })

  test("live variant passes platform/roomId/liveStatus + playUrls", () => {
    const feed: FeedLive = {
      id: "live:douyu:42",
      sourceId: "live:douyu",
      kind: "live",
      title: "直播间",
      fetchedAt: 0,
      platform: "douyu",
      roomId: "42",
      liveStatus: "live",
      online: 999,
      playUrls: ["https://live.m3u8"],
      playHeaders: { Referer: "https://douyu.com" },
      quality: "原画",
      playUrlsExpiresAt: 1_754_000_000_000,
    }
    const [item] = feedItemsToMediaItems([feed], { subscriptionId: "s", now: 0 })
    expect(item).toMatchObject({
      kind: "live",
      platform: "douyu",
      roomId: "42",
      liveStatus: "live",
      online: 999,
      playUrls: ["https://live.m3u8"],
      playHeaders: { Referer: "https://douyu.com" },
      quality: "原画",
      playUrlsExpiresAt: 1_754_000_000_000,
    })
  })
})
