import { test, expect, describe, beforeEach } from "bun:test"
import { registerAllSources } from "../source/register-all.ts"
import { getSource, listBuiltinSubscriptions, __resetSources } from "../source/registry.ts"

const noopHost = {
  http: { async request() { return { status: 200, headers: {}, body: "" } } },
  storage: { async get() { return null }, async set() {}, async delete() {}, async keys() { return [] } },
  js: { eval() { return undefined }, call() { return undefined } },
  log: { log() {} },
  now: () => 1_700_000_000_000,
}

describe("builtinSubscriptions", () => {
  beforeEach(() => {
    __resetSources()
    registerAllSources(noopHost as never)
  })

  test("ids are unique across all sources", () => {
    const ids = listBuiltinSubscriptions().map((e) => e.sub.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test("required fields present per entry", () => {
    for (const { sourceId, sub } of listBuiltinSubscriptions()) {
      expect(sourceId.length).toBeGreaterThan(0)
      expect(sub.id.length).toBeGreaterThan(0)
      expect(sub.title.length).toBeGreaterThan(0)
      expect(sub.config).toBeDefined()
    }
  })

  test("every entry's sourceId has a registered adapter", () => {
    for (const { sourceId, sub } of listBuiltinSubscriptions()) {
      expect(getSource(sourceId), `sourceId ${sourceId} (${sub.id}) should have an adapter`).toBeDefined()
    }
  })

  test("rss carries url in config; bilibili carries route; youtube channelId", () => {
    const all = listBuiltinSubscriptions()
    const hn = all.find((e) => e.sub.id === "hn")!
    const biliHot = all.find((e) => e.sub.id === "bili-hot")!
    const yt = all.find((e) => e.sub.id === "yt-3b1b")!
    expect(hn.sub.config.url).toBe("https://hnrss.org/frontpage")
    expect(biliHot.sub.config.route).toBe("hot-search")
    expect(yt.sub.config.channelId).toBe("UCYO_jab_esuFRV4b17AJtAw")
  })

  test("live entries carry roomId in config with the right sourceId", () => {
    const all = listBuiltinSubscriptions()
    const douyu = all.find((e) => e.sub.id === "live-douyu")!
    expect(douyu.sourceId).toBe("douyu")
    expect(douyu.sub.config.roomId).toBe("3")
    const biliLive = all.find((e) => e.sub.id === "bili-live")!
    expect(biliLive.sourceId).toBe("bilibili")
    expect(biliLive.sub.config.route).toBe("live-room")
    expect(biliLive.sub.config.roomId).toBe("998")
  })

  test("aggregate count matches the sum of per-source builtins", () => {
    const sources = [getSource("rss")!, getSource("bilibili")!, getSource("youtube")!, getSource("douyu")!, getSource("douyin")!, getSource("huya")!]
    const expected = sources.reduce((n, a) => n + (a.builtinSubscriptions?.length ?? 0), 0)
    expect(listBuiltinSubscriptions().length).toBe(expected)
    // rss ships the curated feed catalog.
    expect(getSource("rss")!.builtinSubscriptions?.length).toBeGreaterThanOrEqual(30)
  })
})
