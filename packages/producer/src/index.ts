/**
 * @tauri-playground/producer — the "订阅生产者" layer.
 *
 * Produces RSS 2.0 XML from subscriptions by fetching upstream sources
 * (RSS/Atom feeds + live-platform APIs + bilibili). Independent of core (the
 * maintainer) and apps (the consumer): this package imports nothing outside
 * itself. Every source satisfies the same `SourceAdapter` contract (`toXml`),
 * so externally there is no difference between sources — "producer as a
 * minimal RSSHub".
 *
 * Public surface:
 *   - Types:       types/*  (Subscription, FeedItem, RefreshResult, ProducerHost)
 *   - Source seam: SourceAdapter / BaseSource / registry
 *   - Sources:     RssSource / BilibiliSource / YoutubeSource / DouyuSource / DouyinSource / HuyaSource
 *   - RSS parsing: parseFeed / feedToArticles / extractMedia
 *   - XML:         serializeFeed / deserializeFeed
 */
export * from "./types/feed-item.ts"
export * from "./types/subscription.ts"
export * from "./types/result.ts"
export * from "./types/producer-host.ts"
export * from "./types/live-site.ts"
export type { SourceAdapter, SourceAdapterMeta, SourceConfigField, BuiltinSubscription } from "./source/source-adapter.ts"
export { BaseSource } from "./source/base-source.ts"
export { registerSource, getSource, listSources, overrideSource } from "./source/registry.ts"
export { __resetSources } from "./source/registry.ts"
export { listBuiltinSubscriptions } from "./source/registry.ts"
export type { BuiltinEntry } from "./source/registry.ts"
export { registerAllSources } from "./source/register-all.ts"
export { RssSource } from "./source/rss/rss-source.ts"
export { parseFeed } from "./parse/xml-parser.ts"
export type { ParsedFeed, ParsedItem } from "./parse/xml-parser.ts"
export { feedToArticles } from "./parse/rss-to-items.ts"
export { extractMedia } from "./parse/media.ts"
export { serializeFeed } from "./source/feed-serializer.ts"
export type { SerializeOptions } from "./source/feed-serializer.ts"
export { deserializeFeed } from "./source/feed-deserializer.ts"
export { BilibiliSource } from "./source/bilibili/bilibili-source.ts"
export { YoutubeSource } from "./source/youtube/youtube-source.ts"
export { DouyuSource } from "./source/douyu/source.ts"
export { DouyinSource } from "./source/douyin/source.ts"
export { HuyaSource } from "./source/huya/source.ts"
export { md5Hex } from "./utils/md5.ts"
