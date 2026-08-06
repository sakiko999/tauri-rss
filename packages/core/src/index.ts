/**
 * @tauri-playground/core — 订阅维护者。
 *
 * 基于 crawler(订阅源抓取层)维护订阅列表 + 分组 + 刷新编排 + 持久化。
 * crawler 只输出 RSS 2.0 + `tpl:` XML;core 自己解析 XML、自建渲染模型
 * (MediaItem),不依赖 crawler 的数据模型类型。
 *
 * Public surface:
 *   - 编排:   createDataLayer / DataLayer / RefreshResult
 *   - 订阅:   Subscription / SubscriptionGroup / SubscriptionRepository
 *   - 阅读:   ReadingRepository / ReadRecord / ReadingMap
 *   - 设置:   SettingsRepository / AppSettings / DEFAULT_SETTINGS
 *   - 内容:   MediaItem(判别联合)/ MediaQuery / createMediaStore
 *   - XML:    deserializeFeed(本项目 XML → MediaItem)
 *   - 宿主:   直接访问 globalThis.appHost(门面在 @tauri-playground/host)
 *   - 错误:   NoChannelError
 */
export { createDataLayer } from "./data-layer.ts"
export type { DataLayer } from "./data-layer.ts"
export type { RefreshResult } from "./types/refresh-result.ts"

export type {
  Subscription,
  SubscriptionGroup,
} from "./types/subscription.ts"
export { createSubscriptionRepository } from "./repo/subscription-repo.ts"
export type { SubscriptionRepository } from "./repo/subscription-repo.ts"

export { createReadingRepository } from "./repo/reading-repo.ts"
export type { ReadingRepository } from "./repo/reading-repo.ts"
export type { ReadRecord, ReadingMap } from "./types/reading.ts"

export { createSettingsRepository } from "./repo/settings-repo.ts"
export type { SettingsRepository } from "./repo/settings-repo.ts"
export type { AppSettings, ViewMode, ThemeMode, Density } from "./types/settings.ts"
export { DEFAULT_SETTINGS } from "./types/settings.ts"

export type {
  MediaItem,
  MediaKind,
  MediaItemBase,
  ArticleItem,
  SocialItem,
  VideoItem,
  AudioItem,
  LiveItem,
  MediaAuthor,
  MediaStream,
  MediaAttachment,
  MediaAttachmentKind,
  StreamingFormat,
} from "./types/media-item.ts"
export type { LivePlatformId, LiveStatus } from "./types/live.ts"
export type { MediaQuery } from "./types/query.ts"
export { createMediaStore } from "./store/media-store.ts"
export type { MediaStore, MediaStoreListener } from "./store/media-store.ts"

export { deserializeFeed } from "./xml/deserialize.ts"
export type { DeserializeContext } from "./xml/deserialize.ts"
export { parseFeed } from "@tauri-playground/xml"
export type { ParsedFeed, ParsedItem } from "@tauri-playground/xml"

export { NoChannelError } from "./errors.ts"
