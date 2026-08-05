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
export { feedItemsToMediaItems } from "./feed-to-media.ts"
export type { FeedToMediaOptions } from "./feed-to-media.ts"

// ── Core-owned content model + producer surface (one-stop consumer imports) ──
export * from "./types/media-item.ts"
export type {
  Subscription,
  SubscriptionBase,
  SourceId,
  RssSubscription,
  BilibiliSubscription,
  YoutubeSubscription,
  RssConfig,
  BilibiliConfig,
  YoutubeConfig,
  SubscriptionGroup,
} from "@tauri-playground/producer"
export type { RefreshResult, LivePlayUrl } from "@tauri-playground/producer"
export type { SourceAdapter, SourceAdapterMeta, SourceConfigField } from "@tauri-playground/producer"
export { registerSource, getSource, listSources, overrideSource } from "@tauri-playground/producer"
export { registerAllSources } from "@tauri-playground/producer"
export { RssSource } from "@tauri-playground/producer"
export { BilibiliSource } from "@tauri-playground/producer"
export { YoutubeSource } from "@tauri-playground/producer"
export { DouyuSource } from "@tauri-playground/producer"
export { DouyinSource } from "@tauri-playground/producer"
export { HuyaSource } from "@tauri-playground/producer"
export { deserializeFeed } from "@tauri-playground/producer"
export { parseFeed } from "@tauri-playground/producer"
export type { ParsedFeed, ParsedItem } from "@tauri-playground/producer"
export { feedToArticles } from "@tauri-playground/producer"
export { extractMedia } from "@tauri-playground/producer"
export { md5Hex } from "@tauri-playground/producer"
