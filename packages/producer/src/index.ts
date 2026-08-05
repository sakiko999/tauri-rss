/**
 * @tauri-playground/producer — the "订阅生产者" layer.
 *
 * Produces `MediaItem[]` from subscriptions by fetching upstream sources
 * (RSS/Atom feeds + live-platform APIs). Independent of core (the maintainer)
 * and apps (the consumer): this package imports nothing outside itself.
 *
 * Public surface:
 *   - Types:       types/*  (MediaItem, Subscription, RefreshResult, ProducerHost)
 *   - Source seam: SourceAdapter / RssSource / BilibiliRankSource
 *   - RSS parsing: parseFeed / feedToArticles / extractMedia
 *   - Live:        LiveSource + live-site contract (added as live/ migrates in)
 */
export * from "./types/feed-item.ts"
export * from "./types/subscription.ts"
export * from "./types/result.ts"
export * from "./types/producer-host.ts"
export type { SourceAdapter, SourceAdapterMeta, SourceConfigField } from "./source/source-adapter.ts"
export { registerSource, getSource, listSources, overrideSource } from "./source/registry.ts"
export { __resetSources } from "./source/registry.ts"
export { registerAllSources } from "./source/register-all.ts"
export { PRESETS, getPreset, buildPreset, buildPresetSubscription } from "./presets/index.ts"
export type { PresetSubscription, PresetMeta, PresetRuntime, RssPreset, BilibiliRankPreset, BilibiliPreset, YoutubePreset } from "./presets/index.ts"
export { RssSource } from "./source/rss/rss-source.ts"
export { parseFeed } from "./source/rss/xml-parser.ts"
export type { ParsedFeed, ParsedItem } from "./source/rss/xml-parser.ts"
export { feedToArticles } from "./source/rss/rss-to-items.ts"
export { extractMedia } from "./source/rss/media.ts"
export { serializeFeed } from "./source/feed-serializer.ts"
export type { SerializeOptions } from "./source/feed-serializer.ts"
export { deserializeFeed } from "./source/feed-deserializer.ts"
export { BilibiliRankSource } from "./source/bilibili/bilibili-rank-source.ts"
export { BilibiliSource } from "./source/bilibili/bilibili-source.ts"
export { YoutubeSource } from "./source/youtube/youtube-source.ts"
export type { BilibiliRoute } from "./types/subscription.ts"
export { LiveSource } from "./live/shared/live-source.ts"
export { registerAllLiveSites } from "./live/platforms/index.ts"
export { BilibiliSite } from "./live/platforms/bilibili/site.ts"
export { DouyuSite } from "./live/platforms/douyu/site.ts"
export { DouyinSite } from "./live/platforms/douyin/site.ts"
export { HuyaSite } from "./live/platforms/huya/site.ts"
export { registerLiveSite, getLiveSite, listLiveSites } from "./live/index.ts"
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
export { md5Hex } from "./utils/md5.ts"