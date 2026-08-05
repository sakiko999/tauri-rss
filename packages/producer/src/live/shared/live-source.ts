/**
 * LiveSource — the `SourceAdapter` for live-room subscriptions.
 *
 * Looks up the platform's `LiveSite` from the registry, fetches the room
 * detail + liveness, and maps it to a single `FeedLive`. Live rooms are a
 * feed that yields one item whose `liveStatus` reflects current liveness.
 *
 * Play URLs are NOT resolved here — they're on-demand via
 * `DataLayer.resolveLivePlay()` because they expire and need a multi-step
 * resolve. This keeps refresh cheap (status + metadata only).
 */
import type { FeedLive } from "../../types/feed-item.ts"
import type { ProducerHost } from "../../types/producer-host.ts"
import type { LivePlayUrl } from "../../types/result.ts"
import type { LiveRoomSubscription } from "../../types/subscription.ts"
import type { SourceAdapter } from "../../source/source-adapter.ts"
import { getLiveSite } from "../index.ts"

export class LiveSource implements SourceAdapter<LiveRoomSubscription> {
  readonly kind = "live-room" as const

  async fetch(subscription: LiveRoomSubscription, host: ProducerHost): Promise<FeedLive[]> {
    const site = getLiveSite(subscription.platform)
    if (!site) {
      throw new Error(`No LiveSite registered for platform: ${subscription.platform}`)
    }

    const detail = await site.getRoomDetail(subscription.roomId)
    return [
      {
        id: `${subscription.platform}:${subscription.roomId}`,
        sourceId: `live:${subscription.platform}`,
        kind: "live",
        title: detail.title,
        url: detail.url,
        thumbnail: detail.cover,
        author: { name: detail.userName, avatar: detail.userAvatar || undefined },
        publishedAt: undefined,
        fetchedAt: host.now(),
        platform: subscription.platform,
        roomId: subscription.roomId,
        liveStatus: detail.status ? "live" : "offline",
        online: detail.online,
        isRecord: detail.isRecord,
        introduction: detail.introduction,
        notice: detail.notice,
        showTime: detail.showTime,
        raw: detail.data,
      },
    ]
  }

  /**
   * Lazy resolve of playable URLs (was in `DataLayer.resolveLivePlay`). Live
   * URLs expire, so this is a separate on-demand step, not part of refresh.
   */
  async resolveLivePlay(
    subscription: LiveRoomSubscription,
    _host: ProducerHost,
  ): Promise<LivePlayUrl> {
    const site = getLiveSite(subscription.platform)
    if (!site) throw new Error(`No LiveSite registered for platform: ${subscription.platform}`)
    const detail = await site.getRoomDetail(subscription.roomId)
    const qualities = await site.getPlayQualities(detail)
    const best = qualities[0]
    if (!best) throw new Error(`No play qualities for room ${subscription.roomId}`)
    return site.getPlayUrls(detail, best)
  }
}
