import { test, expect, describe } from "bun:test"
import { BilibiliSource } from "../source/bilibili/bilibili-source.ts"
import type { HttpBackend, HttpRequest, HttpResponse, ProducerHost } from "../types/producer-host.ts"
import type { BilibiliSubscription } from "../types/subscription.ts"

/** Mock host: view → cid, playurl → durl. Records requested URLs. */
function playHost() {
  const urls: string[] = []
  const backend: HttpBackend = {
    async request(req: HttpRequest): Promise<HttpResponse> {
      urls.push(req.url)
      if (req.url.includes("/x/web-interface/view")) {
        return json({ code: 0, data: { bvid: "BV1xx", cid: 40582581827 } })
      }
      if (req.url.includes("/x/player/playurl")) {
        return json({
          code: 0,
          data: {
            quality: 64,
            accept_description: ["高清 720P", "流畅 360P"],
            durl: [
              { order: 1, url: "https://cn-zjhz.bilivideo.com/upgcxcode/1.mp4?e=abc&deadline=123", size: 100 },
              { order: 2, url: "https://cn-zjhz.bilivideo.com/upgcxcode/2.mp4?e=def&deadline=124", size: 200 },
            ],
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

function json(obj: unknown): HttpResponse {
  return { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(obj) }
}

const SUB: BilibiliSubscription = {
  id: "bili-x",
  kind: "bilibili",
  title: "bilibili",
  enabled: true,
  createdAt: 0,
  updatedAt: 0,
  route: "popular",
}

describe("BilibiliSource.resolveVideoPlay", () => {
  test("two-step: view for cid, then playurl for direct mp4 streams", async () => {
    const host = playHost()
    const src = new BilibiliSource()
    const streams = await src.resolveVideoPlay(SUB, host, "BV1xx")

    // 序列:view → playurl
    expect(host.urls[0]).toContain("/x/web-interface/view")
    expect(host.urls[0]).toContain("bvid=BV1xx")
    expect(host.urls[1]).toContain("/x/player/playurl")
    expect(host.urls[1]).toContain("bvid=BV1xx")
    expect(host.urls[1]).toContain("cid=40582581827")

    // 直链流:每 durl 一个,带 referer header
    expect(streams).toHaveLength(2)
    expect(streams[0]).toMatchObject({ url: "https://cn-zjhz.bilivideo.com/upgcxcode/1.mp4?e=abc&deadline=123", format: "mp4" })
    expect(streams[0]?.headers?.referer).toBe("https://www.bilibili.com/")
  })

  test("throws when view returns no cid", async () => {
    const noCidHost: ProducerHost = {
      http: {
        async request() {
          return json({ code: 0, data: {} }) // no cid
        },
      },
      storage: { async get() { return null }, async set() {}, async delete() {}, async keys() { return [] } },
      js: { eval() { return undefined }, call() { return undefined } },
      log: { log() {} },
      now: () => 1_700_000_000_000,
    }
    const src = new BilibiliSource()
    await expect(src.resolveVideoPlay(noCidHost, noCidHost, "BV1xx")).rejects.toThrow(/no cid/)
  })
})
