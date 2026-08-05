/**
 * DouyinSource — 抖音直播 as a source adapter.
 *
 * Wraps the `DouyinSite` live site (ABogus JS signing via `host.js`) behind the
 * `SourceAdapter` seam: a subscription carries a roomId in `config`, `fetch`
 * emits a single `FeedLive`, `resolveLivePlay` lazily resolves playable URLs
 * (local — reads the stream URLs from room detail), and `listRecommendRooms`
 * powers live discovery UIs.
 */
import type { FeedLive } from "../../types/feed-item.ts"
import type { ProducerHost } from "../../types/producer-host.ts"
import type { LivePlayUrl } from "../../types/result.ts"
import type { LiveRoomPage } from "../../types/live-site.ts"
import type { Subscription } from "../../types/subscription.ts"
import { BaseSource } from "../base-source.ts"
import { DouyinSite } from "./site.ts"
import { toFeedLive } from "../../utils/to-feed-live.ts"

export class DouyinSource extends BaseSource<Subscription> {
  readonly sourceId = "douyin" as const
  readonly builtinSubscriptions = [
    { id: "live-douyin", title: "抖音直播示例", tag: "API · 直播", config: { roomId: "1" } },
  ] as const
  readonly meta = {
    name: "抖音直播",
    description: "房间号订阅",
    configSchema: [
      { key: "roomId", label: "房间号", type: "text" as const, required: true },
    ],
  }

  private readonly site: DouyinSite

  constructor(host: ProducerHost) {
    super()
    this.site = new DouyinSite(host)
  }

  createSubscription(
    base: { id: string; sourceId: string; title: string; enabled: boolean; createdAt: number; updatedAt: number },
    config: Record<string, unknown>,
  ): Subscription {
    return { ...base, sourceId: "douyin", config: { roomId: String(config.roomId ?? "") } }
  }

  async fetch(subscription: Subscription, host: ProducerHost): Promise<FeedLive[]> {
    const roomId = String(subscription.config.roomId ?? "")
    if (!roomId) throw new Error("douyin: roomId is required")
    const detail = await this.site.getRoomDetail(roomId)
    return [toFeedLive({ platform: "douyin", roomId, detail, now: host.now() })]
  }

  async resolveLivePlay(subscription: Subscription, _host: ProducerHost): Promise<LivePlayUrl> {
    const roomId = String(subscription.config.roomId ?? "")
    if (!roomId) throw new Error("douyin: roomId is required")
    const detail = await this.site.getRoomDetail(roomId)
    const qualities = await this.site.getPlayQualities(detail)
    const best = qualities[0]
    if (!best) throw new Error(`No play qualities for room ${roomId}`)
    return this.site.getPlayUrls(detail, best)
  }

  async listRecommendRooms(_host: ProducerHost, page = 1): Promise<LiveRoomPage> {
    return this.site.getRecommendRooms(page)
  }
}
