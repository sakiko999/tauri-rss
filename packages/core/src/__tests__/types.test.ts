/**
 * Phase 1 smoke test — proves the type model compiles, discriminated unions
 * narrow correctly, the mock host satisfies PlatformHost, and createDataLayer
 * wires repo+store+adapters together. Fetching logic is Phase 2, so refresh
 * is only exercised against the "no adapter" and "not found" paths here.
 */
import { test, expect, describe } from "bun:test"
import {
  createDataLayer,
  createMediaStore,
  type DataLayer,
  type MediaItem,
  type PlatformHost,
  type Subscription,
  type SubscriptionGroup,
} from "../index.ts"

describe("MediaItem variants", () => {
  test("each kind constructs and narrows on `kind`", () => {
    const fetchedAt = 1700000000000

    const article: MediaItem = {
      id: "a1",
      subscriptionId: "s1",
      sourceId: "rss",
      kind: "article",
      title: "T",
      content: "<p>hi</p>",
      contentFormat: "html",
      fetchedAt,
    }
    const social: MediaItem = {
      id: "so1",
      subscriptionId: "s1",
      sourceId: "rss",
      kind: "social",
      title: "T",
      content: "hello",
      fetchedAt,
    }
    const audio: MediaItem = {
      id: "a1",
      subscriptionId: "s1",
      sourceId: "rss",
      kind: "audio",
      title: "T",
      duration: 180,
      artist: "Artist",
      fetchedAt,
    }
    const video: MediaItem = {
      id: "v1",
      subscriptionId: "s1",
      sourceId: "rss",
      kind: "video",
      title: "T",
      duration: 120,
      fetchedAt,
    }
    const live: MediaItem = {
      id: "l1",
      subscriptionId: "s2",
      sourceId: "live:bilibili",
      kind: "live",
      title: "T",
      platform: "bilibili",
      roomId: "123",
      liveStatus: "live",
      fetchedAt,
    }

    // Discriminated narrowing: kind-specific fields are accessible inside.
    if (article.kind === "article") expect(article.contentFormat).toBe("html")
    if (social.kind === "social") expect(social.content).toBe("hello")
    if (audio.kind === "audio") expect(audio.duration).toBe(180)
    if (video.kind === "video") expect(video.duration).toBe(120)
    if (live.kind === "live") {
      expect(live.platform).toBe("bilibili")
      expect(live.liveStatus).toBe("live")
    }
  })

  test("LiveStatus and LivePlatformId accept all declared values", () => {
    const statuses = ["live", "offline", "unknown"] as const
    const platforms = ["bilibili", "douyu", "huya", "douyin"] as const
    for (const s of statuses) {
      const item = {
        id: "x",
        subscriptionId: "s",
        sourceId: "live",
        kind: "live" as const,
        title: "t",
        platform: "bilibili" as const,
        roomId: "1",
        liveStatus: s,
        fetchedAt: 0,
      }
      expect(item.liveStatus).toBe(s)
    }
    for (const p of platforms) {
      const item = {
        id: "x",
        subscriptionId: "s",
        sourceId: "live",
        kind: "live" as const,
        title: "t",
        platform: p,
        roomId: "1",
        liveStatus: "live" as const,
        fetchedAt: 0,
      }
      expect(item.platform).toBe(p)
    }
  })
})

describe("Subscription variants", () => {
  test("each kind constructs", () => {
    const rss: Subscription = {
      id: "r",
      kind: "rss",
      title: "A blog",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
      url: "https://example/feed.xml",
    }
    const live: Subscription = {
      id: "l",
      kind: "live-room",
      title: "A room",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
      platform: "douyu",
      roomId: "42",
    }
    const group: SubscriptionGroup = { id: "g", title: "Tech" }
    expect(rss.kind).toBe("rss")
    expect(live.kind).toBe("live-room")
    expect(group.title).toBe("Tech")
  })
})

describe("PlatformHost + DataLayer wiring", () => {
  function mockHost(now = 1_700_000_000_000): PlatformHost {
    const mem = new Map<string, string>()
    return {
      http: {
        async request() {
          return { status: 200, headers: {}, body: "<rss/>" }
        },
      },
      storage: {
        async get(k) {
          return mem.get(k) ?? null
        },
        async set(k, v) {
          mem.set(k, v)
        },
        async delete(k) {
          mem.delete(k)
        },
        async keys() {
          return [...mem.keys()]
        },
      },
      js: {
        eval() {
          return undefined
        },
        call() {
          return undefined
        },
      },
      log: {
        log() {
          /* noop */
        },
      },
      now: () => now,
    }
  }

  test("createDataLayer wires repo + store + adapter registry", async () => {
    const dl: DataLayer = createDataLayer(mockHost())
    expect(dl.subscriptions).toBeDefined()
    expect(dl.store.all()).toEqual([])
    expect(dl.store.query()).toEqual([])

    const rss: Subscription = {
      id: "r1",
      kind: "rss",
      title: "Feed",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
      url: "https://example/feed.xml",
    }
    await dl.subscriptions.add(rss)
    expect(await dl.subscriptions.get("r1")).toMatchObject({ kind: "rss" })
  })

  test("refresh on unknown subscription returns an error result (no throw)", async () => {
    const dl = createDataLayer(mockHost())
    const res = await dl.refresh("does-not-exist")
    expect(res.subscriptionId).toBe("does-not-exist")
    expect(res.error).toBeTruthy()
    expect(res.itemCount).toBe(0)
  })

  test("refresh with a failing fetch returns an error result (no throw)", async () => {
    // Override http to return a 500 so the RssSource fetch throws.
    const dl = createDataLayer({
      ...mockHost(),
      http: {
        async request() {
          return { status: 500, headers: {}, body: "err" }
        },
      },
    })
    const rss: Subscription = {
      id: "r2",
      kind: "rss",
      title: "Feed",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
      url: "https://example/feed.xml",
    }
    await dl.subscriptions.add(rss)
    const res = await dl.refresh("r2")
    expect(res.error).toBeTruthy()
    expect(res.itemCount).toBe(0)
  })

  test("store smart-feed queries (today/unread/starred) filter correctly", () => {
    const now = 1_700_000_000_000
    const store = createMediaStore(() => now)
    const items: MediaItem[] = [
      {
        id: "1",
        subscriptionId: "s",
        sourceId: "rss",
        kind: "article",
        title: "today unread starred",
        publishedAt: now,
        isUnread: true,
        isStarred: true,
        fetchedAt: now,
      },
      {
        id: "2",
        subscriptionId: "s",
        sourceId: "rss",
        kind: "article",
        title: "old read unstarred",
        publishedAt: now - 1000 * 60 * 60 * 48,
        isUnread: false,
        fetchedAt: now,
      },
    ]
    expect(store.query({ unreadOnly: true })).toEqual([])
    store.replace("s", items)
    expect(store.query({ starredOnly: true }).map((i) => i.id)).toEqual(["1"])
    expect(store.query({ unreadOnly: true }).map((i) => i.id)).toEqual(["1"])
    expect(store.query({ today: true }).map((i) => i.id)).toEqual(["1"])
    expect(store.query({ subscriptionId: "s" })).toHaveLength(2)
  })

  test("store.subscribe fires on replace/patch/clear", () => {
    const store = createMediaStore(() => 0)
    let calls = 0
    const unsub = store.subscribe(() => {
      calls++
    })
    const items: MediaItem[] = [
      {
        id: "1",
        subscriptionId: "s",
        sourceId: "rss",
        kind: "article",
        title: "T",
        fetchedAt: 0,
      },
    ]
    store.replace("s", items)
    store.patch("1", { isStarred: true })
    store.clear("s")
    expect(calls).toBe(3)
    unsub()
    store.patch("1", { isStarred: false })
    expect(calls).toBe(3) // unsubscribed
  })
})
