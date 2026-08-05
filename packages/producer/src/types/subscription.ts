/**
 * Subscription types — the *config* layer ("what you follow").
 *
 * Separated from `FeedItem` (the *content* fetched from a subscription):
 * one `Subscription` produces N `FeedItem`s joined by `subscriptionId`.
 * Keeping config and content apart lets "smart feeds" (today / unread /
 * starred) become store queries rather than special tree nodes.
 *
 * No `kind` discriminant: a subscription identifies its source by `sourceId`
 * (an open string the adapter registry keys on) and carries its source-specific
 * fields in a nested `config`. Consumers never switch on a kind union — they
 * look up the adapter by `sourceId` and let it interpret `config`. This is the
 * "producer as a minimal RSSHub" boundary: every source is equally just
 * "a subscription → XML".
 */

/** Identifier of a source adapter (registry key), e.g. "rss" | "bilibili" | "douyu". */
export type SourceId = string

/** Fields shared by every subscription variant. */
export interface SubscriptionBase {
  id: string
  /** Which source adapter owns this subscription (registry key). */
  sourceId: SourceId
  title: string
  /** Grouping in the sidebar tree. `null`/`undefined` = top-level. */
  groupId?: string | null
  enabled: boolean
  createdAt: number
  updatedAt: number
  /** Per-subscription override of the default refresh cadence. */
  refreshIntervalSec?: number
}

/**
 * Config shapes are open (`[key: string]: unknown`) so they satisfy the
 * open `Subscription.config: Record<string, unknown>` — any adapter may carry
 * extra source-specific config without widening the shape.
 */
/** A direct RSS/Atom feed URL. */
export interface RssConfig {
  url: string
  [key: string]: unknown
}

/** Bilibili multi-route config (video + hot-search + live room). */
export interface BilibiliConfig {
  route: "hot-search" | "popular" | "ranking" | "weekly" | "user-video" | "live-room"
  /** Ranking partition (e.g. "all"); UP 主 uid for user-video; room for live-room. */
  rid?: string
  uid?: string
  /** 直播房间 id (route="live-room"). */
  roomId?: string
  [key: string]: unknown
}

/** YouTube channel via official RSS. */
export interface YoutubeConfig {
  channelId: string
  [key: string]: unknown
}

/** A live room on any platform. */
export interface LiveRoomConfig {
  roomId: string
  [key: string]: unknown
}

/** A subscription backed by a built-in source adapter (typed convenience). */
export interface RssSubscription extends SubscriptionBase {
  sourceId: "rss"
  config: RssConfig
}

export interface BilibiliSubscription extends SubscriptionBase {
  sourceId: "bilibili"
  config: BilibiliConfig
}

export interface YoutubeSubscription extends SubscriptionBase {
  sourceId: "youtube"
  config: YoutubeConfig
}

/**
 * The open subscription shape: any sourceId + opaque config. Every subscription
 * (built-in or plugin) is this shape at runtime — built-in variants are just
 * narrowings for typed config access. `config` carries the source-specific
 * fields, interpreted by the adapter that owns `sourceId`.
 */
export interface PluginSubscription extends SubscriptionBase {
  sourceId: string
  config: Record<string, unknown>
}

/** Full subscription type exposed to consumers. */
export type Subscription = PluginSubscription

/** Compatibility alias — prefer `Subscription`; kept for code that switches on sourceId. */
export type KnownSubscription = Subscription

/** A user-defined folder in the subscription tree. */
export interface SubscriptionGroup {
  id: string
  title: string
  icon?: string
  /** Nesting; `null`/`undefined` = top-level. */
  parentId?: string | null
}
