/**
 * LiveSource — the `SourceAdapter` for live-room subscriptions.
 *
 * Looks up the platform's `LiveSite` from the registry, fetches the room
 * detail + liveness, and maps it to a single `LiveItem`. Live rooms are a
 * feed that yields one item whose `liveStatus` reflects current liveness.
 *
 * Play URLs are NOT resolved here — they're on-demand via
 * `DataLayer.resolveLivePlay()` because they expire and need a multi-step
 * resolve. This keeps refresh cheap (status + metadata only).
 */
import type { LiveItem } from "../../types/media-item.ts"
import type { PlatformHost } from "../../types/platform.ts"
import type { LiveRoomSubscription } from "../../types/subscription.ts"
import type { SourceAdapter } from "../../source/source-adapter.ts"
import { getLiveSite } from "../index.ts"

export class LiveSource implements SourceAdapter<LiveRoomSubscription> {
  readonly kind = "live-room" as const

  async fetch(subscription: LiveRoomSubscription, host: PlatformHost): Promise<LiveItem[]> {
    const site = getLiveSite(subscription.platform)
    if (!site) {
      throw new Error(`No LiveSite registered for platform: ${subscription.platform}`)
    }

    const detail = await site.getRoomDetail(subscription.roomId)
    return [
      {
        id: `${subscription.platform}:${subscription.roomId}`,
        subscriptionId: subscription.id,
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
}
