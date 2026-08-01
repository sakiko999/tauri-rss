import { test, expect, describe } from "bun:test"
import { BilibiliSite } from "../live/platforms/bilibili/site.ts"
import type { HttpBackend, HttpRequest, HttpResponse, PlatformHost } from "../index.ts"

/**
 * Mock host: returns canned JSON per URL pattern, and records requested URLs
 * so the Wbi-signature shape can be asserted (presence of w_rid/wts).
 */
function bilibiliHost(): PlatformHost & { urls: string[] } {
  const urls: string[] = []
  const backend: HttpBackend = {
    async request(req: HttpRequest): Promise<HttpResponse> {
      urls.push(req.url)
      // nav (wbi keys)
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
      // buvid spi
      if (req.url.includes("/x/frontend/finger/spi")) {
        return json({ data: { "b_3": "buvid3val", "b_4": "buvid4val" } })
      }
      // room info
      if (req.url.includes("/xlive/web-room/v1/index/getInfoByRoom")) {
        return json({
          data: {
            room_info: {
              room_id: 123,
              title: "Test Room",
              cover: "https://cover",
              uname: "Streamer",
              face: "https://face",
              online: 999,
              live_status: 1,
              description: "desc",
              live_start_time: "1700000000",
            },
          },
        })
      }
      // live status cheap check
      if (req.url.includes("/room/v1/Room/get_info")) {
        return json({ data: { live_status: 1 } })
      }
      return json({ data: {} })
    },
  }
  return {
    http: backend,
    storage: { async get() { return null }, async set() {}, async delete() {}, async keys() { return [] } },
    js: { eval() { return undefined }, call() { return undefined } },
    log: { log() {} },
    now: () => 1_700_000_000_000,
    urls,
  }
}

function json(obj: unknown): HttpResponse {
  return { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(obj) }
}

describe("BilibiliSite", () => {
  test("getLiveStatus returns true when live_status==1", async () => {
    const host = bilibiliHost()
    const site = new BilibiliSite(host)
    const live = await site.getLiveStatus("123")
    expect(live).toBe(true)
  })

  test("getRoomDetail maps to LiveRoomDetail and signs the request", async () => {
    const host = bilibiliHost()
    const site = new BilibiliSite(host)
    const detail = await site.getRoomDetail("123")
    expect(detail.title).toBe("Test Room")
    expect(detail.userName).toBe("Streamer")
    expect(detail.status).toBe(true)
    expect(detail.online).toBe(999)
    expect(detail.url).toBe("https://live.bilibili.com/123")
    // The info request was Wbi-signed (w_rid + wts present).
    const infoReq = host.urls.find((u) => u.includes("/getInfoByRoom"))!
    expect(infoReq).toContain("w_rid=")
    expect(infoReq).toContain("wts=")
  })

  test("Wbi signature is deterministic for fixed keys + time + params", async () => {
    // The signature mixin + MD5 should produce a stable w_rid for fixed inputs.
    const host1 = bilibiliHost()
    const host2 = bilibiliHost()
    await new BilibiliSite(host1).getRoomDetail("123")
    await new BilibiliSite(host2).getRoomDetail("123")
    const rid1 = host1.urls.find((u) => u.includes("/getInfoByRoom"))!.match(/w_rid=([a-f0-9]+)/)?.[1]
    const rid2 = host2.urls.find((u) => u.includes("/getInfoByRoom"))!.match(/w_rid=([a-f0-9]+)/)?.[1]
    expect(rid1).toBeDefined()
    expect(rid1).toBe(rid2) // same clock → same signature
  })
})
