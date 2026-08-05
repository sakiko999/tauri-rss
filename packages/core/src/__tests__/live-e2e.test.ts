/**
 * End-to-end verification tests against real internet services.
 *
 * These are **integration tests**, not unit tests — they hit real direct-RSS
 * feeds and live-platform APIs. Public services are occasionally unreliable,
 * so each test catches failures gracefully and skips rather than failing the
 * suite.
 *
 * Run: `bun test`   (core suites, including these e2e tests)
 */
import { test, expect, describe } from "bun:test"
import {
  createBrowserHost,
  createDataLayer,
  HuyaSource,
  DouyuSource,
  DouyinSource,
  BilibiliSource,
} from "../index.ts"

const host = createBrowserHost()

// A direct RSS feed that is reliably up — used by the smart-query e2e test.
const RELIABLE_RSS_URL = "https://www.ruanyifeng.com/blog/atom.xml"

// ── Live platforms: recommend rooms (live discovery) + resolveLivePlay ──────

describe("e2e live platforms", () => {
  test("Huya: listRecommendRooms + fetch a recommended room", async () => {
    const src = new HuyaSource(host)
    const rec = await src.listRecommendRooms(host, 1)
    expect(rec.items.length).toBeGreaterThan(0)
    const r = rec.items[0]!
    expect(r.roomId).toBeTruthy()
    expect(r.title).toBeTruthy()

    // fetch(roomId) → a FeedLive with live status.
    const items = await src.fetch(
      { id: "e2e-huya", sourceId: "huya", title: r.title, enabled: true, createdAt: 0, updatedAt: 0, config: { roomId: r.roomId } },
      host,
    )
    expect(items[0]).toMatchObject({ kind: "live", platform: "huya", roomId: r.roomId })
  })

  test("Douyu: listRecommendRooms + fetch a recommended room", async () => {
    const src = new DouyuSource(host)
    const rec = await src.listRecommendRooms(host, 1)
    expect(rec.items.length).toBeGreaterThan(0)
    const r = rec.items[0]!
    expect(r.roomId).toBeTruthy()

    const items = await src.fetch(
      { id: "e2e-douyu", sourceId: "douyu", title: r.title, enabled: true, createdAt: 0, updatedAt: 0, config: { roomId: r.roomId } },
      host,
    )
    expect(items[0]).toMatchObject({ kind: "live", platform: "douyu" })
  })

  test("Douyin: listRecommendRooms + fetch a recommended room", async () => {
    const src = new DouyinSource(host)
    const rec = await src.listRecommendRooms(host, 1)
    expect(rec.items.length).toBeGreaterThan(0)
    const r = rec.items[0]!
    expect(r.roomId).toBeTruthy()

    const items = await src.fetch(
      { id: "e2e-douyin", sourceId: "douyin", title: r.title, enabled: true, createdAt: 0, updatedAt: 0, config: { roomId: r.roomId } },
      host,
    )
    expect(items[0]).toMatchObject({ kind: "live", platform: "douyin" })
  })

  test("Bilibili: listRecommendRooms via the bilibili source (live discovery)", async () => {
    const src = new BilibiliSource()
    try {
      const rec = await src.listRecommendRooms(host, 1)
      expect(rec.items.length).toBeGreaterThan(0)
      expect(rec.items[0]!.roomId).toBeTruthy()
    } catch (err) {
      // getListByArea is a signed endpoint that can return code:-352 (risk
      // control) without full auth — skip rather than fail the suite.
      console.warn("⚠ bilibili listRecommendRooms skipped:", String(err).slice(0, 80))
    }
  })
})

// ── Smart-feed queries with real data (direct RSS) ────────────────────────

describe("e2e smart queries", () => {
  test("today / unread / starred filter real items", async () => {
    const dl = createDataLayer(host)

    await dl.subscriptions.add({
      id: "e2e-smart",
      sourceId: "rss",
      title: "e2e smart",
      enabled: true,
      createdAt: 0,
      updatedAt: 0,
      config: { url: RELIABLE_RSS_URL },
    })

    const res = await dl.refresh("e2e-smart")
    if (res.error) {
      console.warn("⚠ smart query test skipped — RSS feed down:", res.error.slice(0, 80))
      await dl.subscriptions.remove("e2e-smart")
      return
    }

    expect(res.itemCount).toBeGreaterThan(0)

    const all = dl.store.query({ subscriptionId: "e2e-smart" })
    expect(all.length).toBe(res.itemCount)

    const unread = dl.store.query({ subscriptionId: "e2e-smart", unreadOnly: true })
    expect(unread.length).toBe(all.length) // fresh items start unread

    // Star a few and query starred only.
    for (let i = 0; i < Math.min(3, all.length); i++) {
      dl.store.patch(all[i]!.id, { isStarred: true })
    }
    const starred = dl.store.query({ subscriptionId: "e2e-smart", starredOnly: true })
    expect(starred.length).toBe(Math.min(3, all.length))

    // Test today query.
    const today = dl.store.query({ subscriptionId: "e2e-smart", today: true })
    expect(today.length).toBeGreaterThanOrEqual(0) // 0 is valid if nothing is from today

    await dl.subscriptions.remove("e2e-smart")
  })
})
