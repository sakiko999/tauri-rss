/**
 * Subscription types — the *config* layer ("what you follow").
 *
 * Separated from `MediaItem` (the *content* fetched from a subscription):
 * one `Subscription` produces N `MediaItem`s joined by `subscriptionId`.
 * Keeping config and content apart lets "smart feeds" (today / unread /
 * starred) become store queries rather than special tree nodes.
 */
import type { LivePlatformId } from "./media-item.ts"

/** The kinds of sources a subscription can pull from. */
export type SubscriptionKind = "rss" | "live-room" | "bilibili-rank"

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
  platform: LivePlatformId
  roomId: string
}

/** A Bilibili hot-search / ranking feed (wbi-signed API, no login needed). */
export interface BilibiliRankSubscription extends SubscriptionBase {
  kind: "bilibili-rank"
}

export type Subscription =
  | RssSubscription
  | LiveRoomSubscription
  | BilibiliRankSubscription

/** A user-defined folder in the subscription tree. */
export interface SubscriptionGroup {
  id: string
  title: string
  icon?: string
  /** Nesting; `null`/`undefined` = top-level. */
  parentId?: string | null
}
