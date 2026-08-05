/**
 * Subscription types — the *config* layer ("what you follow").
 *
 * Separated from `MediaItem` (the *content* fetched from a subscription):
 * one `Subscription` produces N `MediaItem`s joined by `subscriptionId`.
 * Keeping config and content apart lets "smart feeds" (today / unread /
 * starred) become store queries rather than special tree nodes.
 */
import type { FeedLivePlatformId } from "./feed-item.ts"

/** Built-in kinds with their own config types (producer ships these). */
export type KnownKind = "rss" | "live-room" | "bilibili-rank" | "bilibili"

/**
 * The kinds of sources a subscription can pull from.
 * Built-in kinds plus any plugin string — `string & {}` keeps literal
 * narrowing for known kinds while still accepting arbitrary plugin kinds.
 */
export type SubscriptionKind = KnownKind | (string & {})

/** Bilibili API route variants handled by the `BilibiliSource` adapter. */
export type BilibiliRoute =
  | "popular" // 综合热门  /x/web-interface/popular
  | "ranking" // 排行榜    /x/web-interface/ranking/v2  (needs `rid`)
  | "weekly" // 每周必看  app.bilibili.com/.../selected
  | "user-video" // UP 主投稿 /x/space/wbi/arc/search (needs `uid`, wbi-signed)

/** Fields shared by every subscription variant. */
export interface SubscriptionBase {
  id: string
  kind: SubscriptionKind
  title: string
  /** Grouping in the sidebar tree. `null`/`undefined` = top-level. */
  groupId?: string | null
  enabled: boolean
  createdAt: number
  updatedAt: number
  /** Per-subscription override of the default refresh cadence. */
  refreshIntervalSec?: number
}

/** A direct RSS/Atom feed URL. */
export interface RssSubscription extends SubscriptionBase {
  kind: "rss"
  url: string
}

/** A live-streaming room to watch for liveness. */
export interface LiveRoomSubscription extends SubscriptionBase {
  kind: "live-room"
  platform: FeedLivePlatformId
  roomId: string
}

/** A Bilibili hot-search / ranking feed (wbi-signed API, no login needed). */
export interface BilibiliRankSubscription extends SubscriptionBase {
  kind: "bilibili-rank"
}

/**
 * A Bilibili API route (video list, ranking, weekly picks). All routes hit
 * `api.bilibili.com` over plain GET; `popular`/`ranking`/`weekly` need no
 * signature, `user-video` is wbi-signed (reuses `source/bilibili/wbi.ts`).
 */
export interface BilibiliSubscription extends SubscriptionBase {
  kind: "bilibili"
  route: BilibiliRoute
  /** Ranking partition id (e.g. "all", "douga", or numeric rid). Required by `ranking`. */
  rid?: string
  /** UP 主 uid. Required by `user-video`. */
  uid?: string
}

/**
 * Plugin-defined kind: arbitrary kind string + opaque extra config fields,
 * interpreted by the plugin adapter itself. This is the open fallback that lets
 * a third-party source register without touching the built-in union.
 */
export interface PluginSubscription extends SubscriptionBase {
  kind: string
  [key: string]: unknown
}

/** Precise union of the built-in variants — where exhaustive checks run. */
export type KnownSubscription =
  | RssSubscription
  | LiveRoomSubscription
  | BilibiliRankSubscription
  | BilibiliSubscription

/** Full union exposed to consumers: built-in variants + open plugin fallback. */
export type Subscription = KnownSubscription | PluginSubscription

/** A user-defined folder in the subscription tree. */
export interface SubscriptionGroup {
  id: string
  title: string
  icon?: string
  /** Nesting; `null`/`undefined` = top-level. */
  parentId?: string | null
}
