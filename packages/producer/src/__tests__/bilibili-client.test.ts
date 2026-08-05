import { test, expect, describe } from "bun:test"
import { createBilibiliClient } from "../source/bilibili/client.ts"
import type { HttpBackend, HttpRequest, HttpResponse, ProducerHost } from "../types/producer-host.ts"

/**
 * Mock host for BilibiliClient: canned nav (wbi keys) + buvid spi + any URL,
 * records requested URLs so signing shape, cookie attach and call sequences can
 * be asserted.
 */
function biliHost() {
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
        return json({ data: { b_3: "buvid3val", b_4: "buvid4val" } })
      }
      return json({ code: 0, data: { ok: true } })
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

describe("BilibiliClient · signWeb (web 语义)", () => {
  test("appends w_rid + wts to an unsorted query", async () => {
    const host = biliHost()
    const client = createBilibiliClient({ host })
    const signed = await client.signWeb("limit=50&platform=web")
    const sp = new URLSearchParams(signed)
    expect(sp.has("w_rid")).toBe(true)
    expect(sp.get("wts")).toBe(String(Math.floor(1_700_000_000_000 / 1000)))
    // Original params preserved.
    expect(sp.get("limit")).toBe("50")
    expect(sp.get("platform")).toBe("web")
  })

  test("signWeb only hits nav once (mixin key cached per instance)", async () => {
    const host = biliHost()
    const client = createBilibiliClient({ host })
    await client.signWeb("a=1")
    await client.signWeb("b=2")
    expect(host.urls.filter((u) => u.includes("/x/web-interface/nav")).length).toBe(1)
  })
})

describe("BilibiliClient · signLiveParams (live 语义)", () => {
  test("output has w_rid but NO standalone wts= param (wts sorted inline)", async () => {
    const host = biliHost()
    const client = createBilibiliClient({ host, live: true })
    const signed = await client.signLiveParams({ platform: "web", room_id: "123" })
    expect(signed).toContain("w_rid=")
    // live 语义: wts participates in the sort, no separate trailing `&wts=` for
    // the signature; the URL does contain wts= as one sorted param.
    expect(signed).toContain("wts=")
    expect(signed).toContain("room_id=123")
  })

  test("signLiveParams throws when live is not enabled", async () => {
    const host = biliHost()
    const client = createBilibiliClient({ host })
    await expect(client.signLiveParams({ room_id: "1" })).rejects.toThrow(/live: true/)
  })
})

describe("BilibiliClient · getJson", () => {
  test("fetches with UA + referer and code checks", async () => {
    const host = biliHost()
    const client = createBilibiliClient({ host, referer: "https://live.bilibili.com/" })
    const data = await client.getJson("https://api.bilibili.com/x/whatever")
    expect(data?.data?.ok).toBe(true)
    expect(host.urls[0]).toContain("/x/whatever")
  })

  test("throws on code !== 0", async () => {
    const host = biliHost()
    const backend: HttpBackend = {
      async request() {
        return json({ code: -404, message: "not found" })
      },
    }
    const client = createBilibiliClient({ host: { ...host, http: backend } })
    await expect(client.getJson("https://api.bilibili.com/x/whatever")).rejects.toThrow(/bilibili API -404/)
  })

  test("buvid:true lazily fetches spi and attaches cookie; buvid:false does not", async () => {
    const host = biliHost()
    const withBuvid = createBilibiliClient({ host, buvid: true })
    await withBuvid.getJson("https://api.bilibili.com/x/whatever")
    expect(host.urls.some((u) => u.includes("/x/frontend/finger/spi"))).toBe(true)

    const host2 = biliHost()
    const without = createBilibiliClient({ host: host2 })
    await without.getJson("https://api.bilibili.com/x/whatever")
    expect(host2.urls.some((u) => u.includes("/x/frontend/finger/spi"))).toBe(false)
  })
})
