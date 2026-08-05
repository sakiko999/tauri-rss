import { test, expect, describe } from "bun:test"
import { BilibiliSource } from "../source/bilibili/bilibili-source.ts"
import type { FeedArticle, FeedLive } from "../types/feed-item.ts"
import type { HttpBackend, HttpRequest, HttpResponse, ProducerHost } from "../types/producer-host.ts"
import type { BilibiliSubscription } from "../types/subscription.ts"

/**
 * Mock host for BilibiliSource: serves canned nav (wbi keys) + one JSON payload
 * per route, records requested URLs so we can assert route endpoints, headers,
 * and the wbi signature shape on signed routes.
 */
function biliHost(payloads: { nav?: unknown; [key: string]: unknown }) {
  const urls: string[] = []
  const backend: HttpBackend = {
    async request(req: HttpRequest): Promise<HttpResponse> {
      urls.push(req.url)
      if (req.url.includes("/x/web-interface/nav")) {
        return json(payloads.nav ?? {
          data: {
            wbi_img: {
              img_url: "https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png",
              sub_url: "https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png",
            },
          },
        })
      }
      for (const [key, value] of Object.entries(payloads)) {
        if (req.url.includes(key)) return json(value)
      }
      return json({ code: 0, data: {} })
    },
  }
  const host: ProducerHost & { urls: string[] } = {
    http: backend,
    storage: { async get() { return null }, async set() {}, async delete() {}, async keys() { return [] } },
    js: { eval() { return undefined }, call() { return undefined } },
    log: { log() {} },
    now: () => 1_700_000_000_000,
    urls,
  }
  return host
}

function json(obj: unknown): HttpResponse {
  return { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(obj) }
}

function sub(partial: Partial<BilibiliSubscription> = {}): BilibiliSubscription {
  return {
    id: "bili-x",
    sourceId: "bilibili",
    title: "bilibili 测试",
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    config: { route: "popular" },
    ...partial,
  }
}

describe("BilibiliSource · 综合热门", () => {
  test("fetches /x/web-interface/popular (no signature) and maps to ArticleItems", async () => {
    const host = biliHost({
      "/x/web-interface/popular": {
        code: 0,
        data: {
          list: [
            { title: "热门视频A", pic: "https://pic/a.jpg", desc: "简介A", pubdate: 1_750_000_000, aid: 111, bvid: "BV1xx", owner: { name: "UP主A" } },
            { title: "热门视频B", pic: "https://pic/b.jpg", desc: "", pubdate: 1_500_000_000, aid: 222, owner: { name: "UP主B" } },
          ],
        },
      },
    })
    const src = new BilibiliSource()
    const items = (await src.fetch(sub({ config: { route: "popular" } }), host)) as FeedArticle[]

    expect(host.urls[0]).toContain("/x/web-interface/popular")
    // popular 无需签名——urls 里不应有 nav
    expect(host.urls.some((u) => u.includes("/x/web-interface/nav"))).toBe(false)

    expect(items).toHaveLength(2)
    // pubdate 在 bvidTime 之后 → bvid 链接
    expect(items[0]).toMatchObject({
      kind: "article",
      title: "热门视频A",
      url: "https://www.bilibili.com/video/BV1xx",
      thumbnail: "https://pic/a.jpg",
      author: { name: "UP主A" },
      publishedAt: 1_750_000_000_000,
    })
    // pubdate 在 bvidTime 之前且无 bvid → av 链接
    expect(items[1].url).toBe("https://www.bilibili.com/video/av222")
    // 视频附件
    expect(items[0].media?.[0]).toMatchObject({ kind: "video", url: "https://www.bilibili.com/video/BV1xx" })
  })
})

describe("BilibiliSource · 排行榜", () => {
  test("rid=all resolves to numeric 0 and hits ranking/v2", async () => {
    const host = biliHost({
      "/x/web-interface/ranking/v2": {
        code: 0,
        data: { list: [{ title: "排行视频", pic: "https://pic/r.jpg", desc: "简介", ctime: 1_750_000_000, aid: 1, bvid: "BV1rr", owner: { name: "UP" } }] },
      },
    })
    const src = new BilibiliSource()
    const items = (await src.fetch(sub({ config: { route: "ranking", rid: "all" } }), host)) as FeedArticle[]
    const url = host.urls[0]!
    expect(url).toContain("/x/web-interface/ranking/v2")
    expect(url).toContain("rid=0")
    expect(url).toContain("web_location=333.934")
    expect(items).toHaveLength(1)
    expect(items[0].url).toBe("https://www.bilibili.com/video/BV1rr")
  })

  test("slug rid maps through the table (douga→1005)", async () => {
    const host = biliHost({
      "/x/web-interface/ranking/v2": { code: 0, data: { list: [] } },
    })
    const src = new BilibiliSource()
    await src.fetch(sub({ config: { route: "ranking", rid: "douga" } }), host)
    expect(host.urls[0]).toContain("rid=1005")
  })
})

describe("BilibiliSource · 每周必看", () => {
  test("fetches series number then the selected list", async () => {
    const host = biliHost({
      "/popular/selected/series": {
        code: 0,
        data: { data: [{ number: 227, name: "第227期" }] },
      },
      "/popular/selected?": {
        code: 0,
        data: {
          list: [
            { title: "周推视频", cover: "https://pic/w.jpg", rcmd_reason: "硬核", param: 123, bvid: "BV1ww" },
          ],
        },
      },
    })
    const src = new BilibiliSource()
    const items = (await src.fetch(sub({ config: { route: "weekly" } }), host)) as FeedArticle[]

    expect(host.urls[0]).toContain("/popular/selected/series")
    expect(host.urls[1]).toContain("number=227")
    expect(items).toHaveLength(1)
    // weekly 的 number>60 强制 bvid 链接
    expect(items[0].url).toBe("https://www.bilibili.com/video/BV1ww")
    expect(items[0].thumbnail).toBe("https://pic/w.jpg")
  })
})

describe("BilibiliSource · UP 主投稿(wbi)", () => {
  test("signs /x/space/wbi/arc/search with w_rid+wts (nav → signed request)", async () => {
    const host = biliHost({
      "/x/space/wbi/arc/search": {
        code: 0,
        data: {
          list: {
            vlist: [
              { title: "投稿A", pic: "https://pic/v.jpg", description: "简介", created: 1_750_000_000, aid: 9, bvid: "BV1vv", author: "UP" },
            ],
          },
        },
      },
    })
    const src = new BilibiliSource()
    const items = (await src.fetch(sub({ config: { route: "user-video", uid: "511068914" } }), host)) as FeedArticle[]

    // 序列:nav 取密钥 → signed arc/search
    expect(host.urls[0]).toContain("/x/web-interface/nav")
    const signedUrl = host.urls[1]!
    expect(signedUrl).toContain("/x/space/wbi/arc/search")
    const sp = new URL(signedUrl).searchParams
    expect(sp.has("w_rid")).toBe(true)
    expect(sp.has("wts")).toBe(true)
    expect(sp.get("mid")).toBe("511068914")

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: "article",
      title: "投稿A",
      url: "https://www.bilibili.com/video/BV1vv",
      author: { name: "UP" },
    })
  })

  test("throws when uid is missing", async () => {
    const host = biliHost({})
    const src = new BilibiliSource()
    await expect(src.fetch(sub({ config: { route: "user-video" } }), host)).rejects.toThrow(/uid/)
  })
})

/** Live-room host: nav + buvid spi + room info + play info, records URLs. */
function liveHost() {
  const urls: string[] = []
  const backend: HttpBackend = {
    async request(req: HttpRequest): Promise<HttpResponse> {
      urls.push(req.url)
      if (req.url.includes("/x/web-interface/nav")) {
        return json({
          data: {
            wbi_img: {
              img_url: "https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png",
              sub_url: "https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png",
            },
          },
        })
      }
      if (req.url.includes("/x/frontend/finger/spi")) {
        return json({ data: { b_3: "b3", b_4: "b4" } })
      }
      if (req.url.includes("/getInfoByRoom")) {
        return json({
          data: {
            room_info: {
              room_id: 998,
              title: "Test Live Room",
              cover: "https://cover",
              uname: "主播A",
              face: "https://face",
              online: 42,
              live_status: 1,
              description: "live desc",
              live_start_time: "1700000000",
            },
          },
        })
      }
      if (req.url.includes("/getRoomPlayInfo")) {
        return json({
          data: {
            playurl_info: {
              playurl: {
                g_qn_desc: [{ qn: 10000, desc: "原画" }],
                stream: [{ format: [{ codec: [{ accept_qn: [10000], base_url: "/live.m3u8", url_info: [{ host: "https://cdn", extra: "?x=1" }] }] }] }],
              },
            },
          },
        })
      }
      return json({ code: 0, data: {} })
    },
  }
  const host: ProducerHost & { urls: string[] } = {
    http: backend,
    storage: { async get() { return null }, async set() {}, async delete() {}, async keys() { return [] } },
    js: { eval() { return undefined }, call() { return undefined } },
    log: { log() {} },
    now: () => 1_700_000_000_000,
    urls,
  }
  return host
}

describe("BilibiliSource · 直播房间", () => {
  test("fetch(live-room) maps room detail to a FeedLive", async () => {
    const host = liveHost()
    const src = new BilibiliSource()
    const items = (await src.fetch(sub({ config: { route: "live-room", roomId: "998" } }), host)) as FeedLive[]

    expect(items).toHaveLength(1)
    const live = items[0]!
    expect(live).toMatchObject({
      kind: "live",
      platform: "bilibili",
      roomId: "998",
      liveStatus: "live",
      online: 42,
      title: "Test Live Room",
      author: { name: "主播A" },
      url: "https://live.bilibili.com/998",
    })
    expect(live.sourceId).toBe("live:bilibili")
  })

  test("fetch(live-room) throws when roomId is missing", async () => {
    const host = liveHost()
    const src = new BilibiliSource()
    await expect(src.fetch(sub({ config: { route: "live-room" } }), host)).rejects.toThrow(/roomId/)
  })

  test("resolveLivePlay does the room→qualities→urls resolve for live-room", async () => {
    const host = liveHost()
    const src = new BilibiliSource()
    const play = await src.resolveLivePlay(sub({ config: { route: "live-room", roomId: "998" } }), host)

    expect(host.urls.some((u) => u.includes("/getInfoByRoom"))).toBe(true)
    expect(host.urls.some((u) => u.includes("/getRoomPlayInfo"))).toBe(true)
    expect(play.urls.length).toBeGreaterThan(0)
    expect(play.urls[0]).toContain("https://cdn")
  })

  test("resolveLivePlay throws for non-live-room routes", async () => {
    const host = liveHost()
    const src = new BilibiliSource()
    await expect(src.resolveLivePlay(sub({ config: { route: "popular" } }), host)).rejects.toThrow(/only supports route='live-room'/)
  })

  test("resolveVideoPlay throws for live-room route", async () => {
    const host = liveHost()
    const src = new BilibiliSource()
    await expect(src.resolveVideoPlay(sub({ config: { route: "live-room", roomId: "998" } }), host, "BV1xx")).rejects.toThrow(/not support route='live-room'/)
  })

  test("createSubscription passes roomId through", () => {
    const src = new BilibiliSource()
    const s = src.createSubscription(
      { id: "x", sourceId: "bilibili", title: "x", enabled: true, createdAt: 0, updatedAt: 0 },
      { route: "live-room", roomId: "42" },
    )
    expect(s).toMatchObject({ sourceId: "bilibili", config: { route: "live-room", roomId: "42" } })
  })
})

describe("BilibiliSource · 热搜", () => {
  test("signs /wbi/search/square and maps trending keywords to ArticleItems", async () => {
    const host = biliHost({
      "/wbi/search/square": {
        code: 0,
        data: {
          trending: {
            title: "热搜",
            list: [
              { keyword: "U17国足3-2绝杀阿森纳", icon: "https://icon" },
              { keyword: "Jiejie加入EDG" },
            ],
          },
        },
      },
    })
    const src = new BilibiliSource()
    const items = (await src.fetch(sub({ config: { route: "hot-search" } }), host)) as FeedArticle[]

    // 序列:nav 取密钥 → signed square
    expect(host.urls[0]).toContain("/x/web-interface/nav")
    const squareUrl = host.urls[1]!
    expect(squareUrl).toContain("/wbi/search/square")
    const sp = new URL(squareUrl).searchParams
    expect(sp.has("w_rid")).toBe(true)
    expect(sp.has("wts")).toBe(true)

    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      kind: "article",
      title: "U17国足3-2绝杀阿森纳",
      summary: '<img src="https://icon">',
      content: "<p>U17国足3-2绝杀阿森纳</p>",
      sourceId: "bilibili",
    })
    expect(items[1].title).toBe("Jiejie加入EDG")
  })
})
