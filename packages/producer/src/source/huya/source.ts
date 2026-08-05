/**
 * HuyaSource — 虎牙直播 as a source adapter.
 *
 * Wraps the `HuyaSite` live site (HTTP-only: scrapes `m.huya.com` room HTML)
 * behind the `SourceAdapter` seam: a subscription carries a roomId in `config`,
 * `fetch` emits a single `FeedLive`, and `listRecommendRooms` powers live
 * discovery UIs. `resolveLivePlay` throws `NotImplementedError` because Huya's
 * play URLs need the Tars binary codec (deferred to a later phase).
 */
import { NotImplementedError } from "../../errors.ts"
import type { FeedLive } from "../../types/feed-item.ts"
import type { ProducerHost } from "../../types/producer-host.ts"
import type { LivePlayUrl } from "../../types/result.ts"
import type { LiveRoomPage } from "../../types/live-site.ts"
import type { Subscription } from "../../types/subscription.ts"
import { BaseSource } from "../base-source.ts"
import { HuyaSite } from "./site.ts"
import { toFeedLive } from "../../utils/to-feed-live.ts"

export class HuyaSource extends BaseSource<Subscription> {
  readonly sourceId = "huya" as const
  readonly builtinSubscriptions = [
    { id: "live-huya", title: "虎牙直播示例", tag: "API · 直播", config: { roomId: "1" } },
  ] as const
  readonly meta = {
    name: "虎牙直播",
    description: "房间号订阅",
    configSchema: [
      { key: "roomId", label: "房间号", type: "text" as const, required: true },
    ],
  }

  private readonly site: HuyaSite

  constructor(host: ProducerHost) {
    super()
    this.site = new HuyaSite(host)
  }

  createSubscription(
    base: { id: string; sourceId: string; title: string; enabled: boolean; createdAt: number; updatedAt: number },
    config: Record<string, unknown>,
  ): Subscription {
    return { ...base, sourceId: "huya", config: { roomId: String(config.roomId ?? "") } }
  }

  async fetch(subscription: Subscription, host: ProducerHost): Promise<FeedLive[]> {
    const roomId = String(subscription.config.roomId ?? "")
    if (!roomId) throw new Error("huya: roomId is required")
    const detail = await this.site.getRoomDetail(roomId)
    return [toFeedLive({ platform: "huya", roomId, detail, now: host.now() })]
  }

  /** Huya play URLs need the Tars binary codec — deferred to a later phase. */
  async resolveLivePlay(_subscription: Subscription, _host: ProducerHost): Promise<LivePlayUrl> {
    throw new NotImplementedError("Huya playUrl needs the Tars codec — deferred to a later phase")
  }

  async listRecommendRooms(_host: ProducerHost, page = 1): Promise<LiveRoomPage> {
    return this.site.getRecommendRooms(page)
  }
}
