/**
 * @tauri-playground/core — 订阅维护者。
 *
 * 基于 crawler(订阅源抓取层)维护订阅列表 + 分组 + 刷新编排 + 持久化。
 * crawler 只输出 RSS 2.0 + `tpl:` XML;core 自己解析 XML、自建渲染模型
 * (MediaItem),不依赖 crawler 的数据模型类型。
 *
 * Public surface(apps 唯一数据入口 = createDataLayer + 稳定类型):
 *   - 编排:   createDataLayer / DataLayer / RefreshResult / ChannelInfo
 *   - 订阅:   Subscription / SubscriptionGroup(CRUD 走 DataLayer.subscriptions)
 *   - 设置:   AppSettings / DEFAULT_SETTINGS(读写走 DataLayer.settings)
 *   - 内容:   MediaItem(判别联合)/ MediaStream / MediaQuery / ResolvePlayback
 *   - 错误:   NoChannelError
 *   - 宿主:   直接访问 globalThis.appHost(门面在 @tauri-playground/host)
 *
 * 收敛内部:repo/media-store/xml 反序列化/parseFeed 均不对外(core 内部实现)。
 * apps 不直接 import crawler(渠道能力经 DataLayer.listChannels/channelKind)。
 */
export { createDataLayer } from "./data-layer.ts"
export type { DataLayer } from "./data-layer.ts"
export type { ChannelInfo } from "./types/channel-info.ts"
export type { RefreshResult } from "./types/refresh-result.ts"

export type {
  Subscription,
  SubscriptionGroup,
} from "./types/subscription.ts"

/**
 * ⚠️ 只导出 `AppSettings` 与需要的联合类型。`ViewMode` / `ThemeMode` / `Density`
 * 是 AppSettings 的字段类型,**不导出** —— 表现型偏好(主题/密度/字号)在桌面端归
 * `apps/desktop/src/store/prefs.ts`(localStorage,首帧脚本要同步读),那里有各自的
 * 取值域(如 Density 是 relaxed|standard|compact)。两边同名不同义,导出会变成陷阱。
 */
export type { AppSettings, QualityMode } from "./types/settings.ts"
export { DEFAULT_SETTINGS } from "./types/settings.ts"

export type {
  MediaItem,
  MediaKind,
  MediaItemBase,
  ArticleItem,
  SocialItem,
  SocialImage,
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
export type { ResolvePlayback } from "./types/playback.ts"

export { NoChannelError } from "./errors.ts"

/** 续播位置落库决策(近片尾清除 / 5s 节流)——desktop/mobile 两个 store 共用。 */
export { positionDecision, type PositionDecision } from "./reading-position.ts"

/** SQLite schema(两端共用 DDL:desktop tauri-plugin-sql / CLI bun:sqlite)。 */
export { KV_TABLE, KV_DDL, MIGRATIONS } from "./db/schema.ts"

/** 订阅抓取内容缓存(KV storage 实现;TTL 判定在 data-layer)。 */
export { createContentCacheRepo, type ContentCacheEntry, type ContentCacheRepo } from "./repo/content-cache-repo.ts"
