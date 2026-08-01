/**
 * @tauri-playground/core — data layer for the Tauri RSS reader
 * (RSS/Atom + live streams, one typed media model).
 *
 * Public surface:
 *   - Types:         `types/*`
 *   - Host seam:     `host/*`
 *   - Integration:   `createDataLayer`, `DataLayer`
 *   - Live contract: `live/*`
 *   - Media:         `source/rss/media.ts`, `content/classifier.ts`
 */
export * from "./types/index.ts"
export * from "./host/platform-host.ts"
export { createBrowserHost } from "./host/browser-host.ts"
export type { BrowserHostOptions } from "./host/browser-host.ts"
export { FetchHttpBackend, LocalStorageBackend, ConsoleLogger } from "./host/browser-host.ts"
export { FunctionJsBackend } from "./host/browser-host.ts"
export { createDataLayer } from "./data-layer.ts"
export type { DataLayer, DataLayerOptions } from "./data-layer.ts"
export type { SourceAdapter } from "./source/source-adapter.ts"
export { RssSource } from "./source/rss/rss-source.ts"
export { parseFeed } from "./source/rss/xml-parser.ts"
export type { ParsedFeed, ParsedItem } from "./source/rss/xml-parser.ts"
export { feedToArticles } from "./source/rss/rss-to-items.ts"
export { extractMedia } from "./source/rss/media.ts"
export { inferContent, classifyMediaItem, socialContent } from "./content/classifier.ts"
export { LiveSource } from "./live/shared/live-source.ts"
export { registerAllLiveSites } from "./live/platforms/index.ts"
export { BilibiliSite } from "./live/platforms/bilibili/site.ts"
export { DouyuSite } from "./live/platforms/douyu/site.ts"
export { DouyinSite } from "./live/platforms/douyin/site.ts"
export { HuyaSite } from "./live/platforms/huya/site.ts"
export { md5Hex } from "./live/shared/md5.ts"
export {
  createSubscriptionRepository,
  isSubscription,
} from "./repo/subscription-repository.ts"
export type { SubscriptionRepository } from "./repo/subscription-repository.ts"
export {
  createReadingRepository,
} from "./repo/reading-repository.ts"
export type { ReadingRepository } from "./repo/reading-repository.ts"
export {
  createSettingsRepository,
} from "./repo/settings-repository.ts"
export type { SettingsRepository } from "./repo/settings-repository.ts"
export { createMediaStore } from "./store/media-store.ts"
export type { MediaStore, MediaQuery, MediaStoreListener } from "./store/media-store.ts"
export { NotImplementedError, NoAdapterError } from "./errors.ts"
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
} from "./live/live-site.ts"
export { registerLiveSite, getLiveSite, listLiveSites } from "./live/index.ts"
