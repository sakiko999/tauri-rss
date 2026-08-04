/** Public type surface of `@tauri-playground/core` (maintainer layer). */
export * from "./platform.ts"
export * from "./content.ts"
export * from "./reading.ts"
export * from "./settings.ts"
export * from "./queries.ts"
// Producer-owned contracts (MediaItem / Subscription / result) are re-exported
// from the producer package so consumers get one surface. core is the maintainer
// and depends on producer's types.
export type {
  MediaItem,
  ArticleItem,
  SocialItem,
  VideoItem,
  AudioItem,
  LiveItem,
  MediaAttachment,
  MediaAttachmentKind,
  MediaAuthor,
  MediaKind,
  LivePlatformId,
  StreamingFormat,
} from "@tauri-playground/producer"
export type {
  Subscription,
  SubscriptionBase,
  SubscriptionKind,
  RssSubscription,
  LiveRoomSubscription,
  BilibiliRankSubscription,
  SubscriptionGroup,
} from "@tauri-playground/producer"
export type { RefreshResult, LivePlayUrl } from "@tauri-playground/producer"
export type { SourceAdapter } from "@tauri-playground/producer"
