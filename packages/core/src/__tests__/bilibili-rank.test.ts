import { test, expect, describe } from "bun:test"
import { BilibiliRankSource } from "../source/bilibili/bilibili-rank-source.ts"
import type { HttpBackend, HttpRequest, HttpResponse, PlatformHost } from "../index.ts"

/**
 * Mock host for BilibiliRankSource: returns canned nav (wbi keys) + hot-search
 * payload, and records requested URLs so the wbi-signature shape (w_rid + wts
 * present) and the nav→sign→fetch sequence can be asserted.
 */
function biliRankHost(): PlatformHost & { urls: string[] } {
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
      if (req.url.includes("/wbi/search/square")) {
        return json({
          data: {
            trending: {
              title: "热搜",
              list: [
                { keyword: "U17国足3-2绝杀阿森纳", icon: "https://icon" },
                { keyword: "Jiejie加入EDG" },
              ],
            },
          },
        })
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

const SUB: { id: string; kind: "bilibili-rank"; title: string; enabled: boolean; createdAt: number; updatedAt: number } = {
  id: "bili-hot",
  kind: "bilibili-rank",
  title: "bilibili热搜",
  enabled: true,
  createdAt: 0,
  updatedAt: 0,
}

describe("BilibiliRankSource", () => {
  test("fetches hot-search via nav(wbi keys) → signed square endpoint", async () => {
    const host = biliRankHost()
    const src = new BilibiliRankSource()
    const items = await src.fetch(SUB, host)

    // Sequence: nav first, then the signed hot-search request.
    expect(host.urls[0]).toContain("/x/web-interface/nav")
    const squareUrl = host.urls[1]!
    expect(squareUrl).toContain("/search/square")

    // w_rid + wts present on the hot-search request (wbi signing applied).
    const sp = new URL(squareUrl).searchParams
    expect(sp.has("w_rid")).toBe(true)
    expect(sp.has("wts")).toBe(true)
    expect(String(sp.get("wts"))).toBe(String(Math.floor(1_700_000_000_000 / 1000)))

    // Items mapped to ArticleItem with title/url/subscriptionId.
    expect(items).toHaveLength(2)
    const first = items[0] as { title: string; url: string; kind: string; subscriptionId: string; isUnread: boolean }
    expect(first.kind).toBe("article")
    expect(first.title).toBe("U17国足3-2绝杀阿森纳")
    expect(first.subscriptionId).toBe("bili-hot")
    expect(first.isUnread).toBe(true)
    expect(items[1]).toMatchObject({ title: "Jiejie加入EDG" })
  })
})