/**
 * @tauri-playground/core — the "订阅维护者" (maintainer) layer.
 *
 * Assembles the producer's source adapters into a data layer: repo (subscription
 * config persistence), media store (content cache), and refresh orchestration.
 *
 * Public surface:
 *   - Types (own):      `types/*` (content/platform/reading/settings/queries)
 *   - Types (producer): re-exported from @tauri-playground/producer so consumers
 *                       get MediaItem / Subscription / result in one place.
 *   - Host seam:        `host/*` (PlatformHost implementations)
 *   - Integration:      `createDataLayer`, `DataLayer`
 *   - Producer:         adapters + parsing re-exported for convenience
 */
export * from "./types/index.ts"
export * from "./host/platform-host.ts"
export { createBrowserHost } from "./host/browser-host.ts"
export type { BrowserHostOptions } from "./host/browser-host.ts"
export { FetchHttpBackend, LocalStorageBackend, ConsoleLogger } from "./host/browser-host.ts"
export { FunctionJsBackend } from "./host/browser-host.ts"
export { createDataLayer } from "./data-layer.ts"
export type { DataLayer, DataLayerOptions } from "./data-layer.ts"
export { inferContent, classifyMediaItem, socialContent } from "./content/classifier.ts"
export { NotImplementedError, NoAdapterError } from "./errors.ts"
export { createSubscriptionRepository, isSubscription } from "./repo/subscription-repository.ts"
export type { SubscriptionRepository } from "./repo/subscription-repository.ts"
export { createReadingRepository } from "./repo/reading-repository.ts"
export type { ReadingRepository } from "./repo/reading-repository.ts"
export { createSettingsRepository } from "./repo/settings-repository.ts"
export type { SettingsRepository } from "./repo/settings-repository.ts"
export { createMediaStore } from "./store/media-store.ts"
export type { MediaStore, MediaQuery, MediaStoreListener } from "./store/media-store.ts"

// ── Producer surface (re-exported for one-stop consumer imports) ────────────
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
export { RssSource } from "@tauri-playground/producer"
export { parseFeed } from "@tauri-playground/producer"
export type { ParsedFeed, ParsedItem } from "@tauri-playground/producer"
export { feedToArticles } from "@tauri-playground/producer"
export { extractMedia } from "@tauri-playground/producer"
export { BilibiliRankSource } from "@tauri-playground/producer"
export { LiveSource } from "@tauri-playground/producer"
export { registerAllLiveSites } from "@tauri-playground/producer"
export { BilibiliSite } from "@tauri-playground/producer"
export { DouyuSite } from "@tauri-playground/producer"
export { DouyinSite } from "@tauri-playground/producer"
export { HuyaSite } from "@tauri-playground/producer"
export { md5Hex } from "@tauri-playground/producer"
export type {
  LiveSite,
  LiveCategory,
  LiveSubCategory,
  LiveRoomItem,
  LiveRoomPage,
  LiveAnchorItem,
  LiveAnchorPage,
  LivePlayQuality,
  LiveRoomDetail,
} from "@tauri-playground/producer"
export { registerLiveSite, getLiveSite, listLiveSites } from "@tauri-playground/producer"
