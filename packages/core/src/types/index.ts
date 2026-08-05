/** Public type surface of `@tauri-playground/core` (maintainer layer). */
export * from "./platform.ts"
export * from "./content.ts"
export * from "./reading.ts"
export * from "./settings.ts"
export * from "./queries.ts"
// Core-owned content model — the render layer's `MediaItem` union (moved here
// from the producer package; producer keeps its own protocol `FeedItem`).
export * from "./media-item.ts"
export * from "./live.ts"
// Producer-owned contracts (Subscription / result / source seam) re-exported so
// consumers get one surface. core is the maintainer and depends on producer.
export type {
  Subscription,
  SubscriptionBase,
  SubscriptionKind,
  KnownKind,
  KnownSubscription,
  PluginSubscription,
  RssSubscription,
  LiveRoomSubscription,
  BilibiliRankSubscription,
  BilibiliSubscription,
  SubscriptionGroup,
} from "@tauri-playground/producer"
export type { RefreshResult, LivePlayUrl } from "@tauri-playground/producer"
export type { SourceAdapter, SourceAdapterMeta, SourceConfigField } from "@tauri-playground/producer"
