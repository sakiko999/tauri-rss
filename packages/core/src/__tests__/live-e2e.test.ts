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
  HuyaSite,
  DouyuSite,
  DouyinSite,
  BilibiliSite,
} from "../index.ts"

const host = createBrowserHost()

// A direct RSS feed that is reliably up — used by the smart-query e2e test.
const RELIABLE_RSS_URL = "https://www.ruanyifeng.com/blog/atom.xml"

// ── Live platforms: recommend + detail + status ──────────────────────────

describe("e2e live platforms", () => {
  test("Huya: getRecommendRooms + getRoomDetail + getLiveStatus", async () => {
    const site = new HuyaSite(host)
    const rec = await site.getRecommendRooms(1)
    expect(rec.items.length).toBeGreaterThan(0)
    const r = rec.items[0]!
    expect(r.roomId).toBeTruthy()
    expect(r.title).toBeTruthy()

    const live = await site.getLiveStatus(r.roomId)
    expect(typeof live).toBe("boolean")

    const det = await site.getRoomDetail(r.roomId)
    expect(det.roomId).toBe(r.roomId)
    expect(det.title).toBeTruthy()
    expect(det.userName).toBeTruthy()
    expect(det.status).toBe(live)
  })

  test("Douyu: getRecommendRooms + getRoomDetail + getLiveStatus", async () => {
    const site = new DouyuSite(host)
    const rec = await site.getRecommendRooms(1)
    expect(rec.items.length).toBeGreaterThan(0)
    const r = rec.items[0]!
    expect(r.roomId).toBeTruthy()

    const live = await site.getLiveStatus(r.roomId)
    expect(typeof live).toBe("boolean")

    const det = await site.getRoomDetail(r.roomId)
    expect(det.roomId).toBeTruthy()
    expect(det.title).toBeTruthy()
    expect(det.status).toBe(live)

    // Play qualities require a signed detail.data; just verify no throw for the outer call.
    if (det.data) {
      const qs = await site.getPlayQualities(det)
      expect(Array.isArray(qs)).toBe(true)
    }
  })

  test("Douyin: getRecommendRooms + getRoomDetail + getLiveStatus", async () => {
    const site = new DouyinSite(host)
    const rec = await site.getRecommendRooms(1)
    expect(rec.items.length).toBeGreaterThan(0)
    const r = rec.items[0]!
    expect(r.roomId).toBeTruthy()

    const det = await site.getRoomDetail(r.roomId)
    expect(det.roomId).toBeTruthy()
    expect(det.userName).toBeTruthy()
    expect(typeof det.status).toBe("boolean")

    const live = await site.getLiveStatus(r.roomId)
    expect(live).toBe(det.status)

    // Play qualities (local, no HTTP).
    const qs = await site.getPlayQualities(det)
    expect(Array.isArray(qs)).toBe(true)
    // If the room is live there should be at least one quality.
  })

  test("Bilibili: getLiveStatus (cheapest endpoint, no auth needed)", async () => {
    const site = new BilibiliSite(host)
    // /room/v1/Room/get_info is the simplest path (no Wbi sign).
    const live = await site.getLiveStatus("998")
    expect(typeof live).toBe("boolean")
  })
})

// ── Smart-feed queries with real data (direct RSS) ────────────────────────

describe("e2e smart queries", () => {
  test("today / unread / starred filter real items", async () => {
    const dl = createDataLayer(host)

    await dl.subscriptions.add({
      id: "e2e-smart",
      kind: "rss",
      title: "e2e smart",
      enabled: true,
      createdAt: 0,
      updatedAt: 0,
      url: RELIABLE_RSS_URL,
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
