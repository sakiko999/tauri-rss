/**
 * toFeedLive — map a `LiveRoomDetail` to a single `FeedLive` protocol item.
 *
 * Shared by the per-platform live sources (bilibili via BilibiliSource's
 * live-room route, douyu/douyin/huya via their own sources). The mapping is
 * identical across platforms — only `platform`/`sourceId`/`id` differ.
 */
import type { FeedLive, FeedLivePlatformId } from "../types/feed-item.ts"
import type { LiveRoomDetail } from "../types/live-site.ts"

export function toFeedLive(opts: {
  platform: FeedLivePlatformId
  roomId: string
  detail: LiveRoomDetail
  now: number
}): FeedLive {
  const { platform, roomId, detail, now } = opts
  return {
    id: `${platform}:${roomId}`,
    sourceId: `live:${platform}`,
    kind: "live",
    title: detail.title,
    url: detail.url,
    thumbnail: detail.cover,
    author: { name: detail.userName, avatar: detail.userAvatar || undefined },
    publishedAt: undefined,
    fetchedAt: now,
    platform,
    roomId,
    liveStatus: detail.status ? "live" : "offline",
    online: detail.online,
    isRecord: detail.isRecord,
    introduction: detail.introduction,
    notice: detail.notice,
    showTime: detail.showTime,
    raw: detail.data,
  }
}
