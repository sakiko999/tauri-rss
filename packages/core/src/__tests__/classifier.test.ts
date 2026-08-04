/**
 * Classifier tests — inferContent/classifyMediaItem decide an item's primary
 * Content kind from its text body + media attachments. This lives in core
 * (the maintainer/consumer boundary), not producer: classification is what the
 * consumer renders, distinct from producer extraction.
 */
import { test, expect, describe } from "bun:test"
import { inferContent } from "../content/classifier.ts"

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
