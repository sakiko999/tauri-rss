/**
 * Live platform identifiers — owned by core (the render model layer).
 *
 * The producer has its own structurally-identical `FeedLivePlatformId`
 * (packages/producer/src/types/feed-item.ts) to stay import-free of core. Both
 * are the same string-literal union, so values flow between them without casts.
 */
export type LivePlatformId = "bilibili" | "douyu" | "huya" | "douyin"
export type LiveStatus = "live" | "offline" | "unknown"
