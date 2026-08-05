/**
 * SourceAdapter — the seam between the producer's fetch adapters and the
 * maintainer (`createDataLayer`). Turns a `Subscription` into RSS XML.
 *
 * `FeedItem` is the producer's *internal protocol* (see types/feed-item.ts) —
 * NOT the app content model. Core bridges FeedItem → its own MediaItem via
 * `feed-to-media.ts`; external consumers use `toXml` for pure RSS XML.
 *
 * The adapter is keyed by `sourceId` (an open string), not a `kind` union. A
 * third-party platform implements `SourceAdapter` and registers itself via
 * `registerSource(new XxxSource())` — no changes to the subscription shape or
 * to core's data layer are required. The optional `meta` lets the registry be
 * surfaced as a "supported platforms / add subscription" form.
 *
 * `toXml` is the first-class external contract: every source (RSS, bilibili,
 * douyu, youtube, …) produces standard RSS 2.0 + `tpl:` extension XML, so to an
 * external consumer there is no difference between sources. Adapters inherit a
 * default `toXml` (`fetch → serializeFeed`) from `BaseSource`.
 */
import type { FeedItem, FeedStream } from "../types/feed-item.ts"
import type { ProducerHost } from "../types/producer-host.ts"
import type { LivePlayUrl } from "../types/result.ts"
import type { LiveRoomPage } from "../types/live-site.ts"
import type { Subscription } from "../types/subscription.ts"

/** A single field definition for the "add subscription" form. */
export interface SourceConfigField {
  key: string
  label: string
  type: "text" | "number" | "select" | "textarea"
  required?: boolean
  placeholder?: string
  options?: { value: string; label: string }[]
}

/** Self-describing metadata — lets a registry be surfaced as a platform list. */
export interface SourceAdapterMeta {
  /** Human-readable name, e.g. "GitHub Releases". */
  name: string
  /** One-line description. */
  description?: string
  /** Form fields for creating a subscription of this kind (optional). */
  configSchema?: SourceConfigField[]
}

/**
 * A built-in subscribable source the adapter ships with (a curated feed, a
 * known channel, a popular live room, …). Sources declare these so consumers
 * (scripts, discovery UIs) can enumerate them without a separate presets layer.
 */
export interface BuiltinSubscription {
  /** Stable id (a preset-style id, e.g. "hn", "bili-hot"). */
  id: string
  title: string
  /** Human-readable media/format label, e.g. "RSS · 纯文". */
  tag?: string
  /** Source-specific config, matching `createSubscription`. */
  config: Record<string, unknown>
}

export interface SourceAdapter<S extends Subscription = Subscription> {
  /** Registry key matching the subscription's `sourceId`. */
  readonly sourceId: string
  /** Display metadata (optional, for registry-driven UIs). */
  readonly meta?: SourceAdapterMeta
  /** Pull the current set of protocol items for a subscription. */
  fetch(subscription: S, host: ProducerHost): Promise<FeedItem[]>
  /**
   * External exit: fetch + serialize to RSS 2.0 (+ tpl:) XML. The first-class
   * contract every source satisfies, so any consumer sees uniform XML. Default
   * (from `BaseSource`) = fetch then `serializeFeed`.
   */
  toXml(subscription: S, host: ProducerHost): Promise<string>
  /**
   * Optional capability: lazily resolve playable URLs. Only live-ish plugins
   * implement this; when absent, `DataLayer.resolveLivePlay` throws
   * "does not support resolveLivePlay".
   */
  resolveLivePlay?(subscription: S, host: ProducerHost): Promise<LivePlayUrl>
  /**
   * Optional capability: lazily resolve a video item's playable streams.
   * Unlike `resolveLivePlay` (subscription-scoped — a live room), this is
   * item-scoped: a video subscription has many items, so `videoId` (the item's
   * `id`, e.g. bilibili bvid) picks which one to resolve. When absent,
   * `DataLayer.resolveVideoPlay` throws "does not support resolveVideoPlay".
   * Stream URLs typically carry an expiry signature — never cache in refresh.
   */
  resolveVideoPlay?(subscription: S, host: ProducerHost, videoId: string): Promise<FeedStream[]>
  /**
   * Optional factory: build a complete `Subscription` from form values. This is
   * the "external picks a channel → enters an id → gets a subscribe-able source
   * link" seam. `base` carries the fields every subscription needs (id, title,
   * enabled, timestamps, sourceId); `config` carries the source-specific values
   * that match `meta.configSchema`. When absent, the registry-driven UI falls
   * back to a generic subscription with config copied verbatim.
   */
  createSubscription?(
    base: {
      id: string
      sourceId: string
      title: string
      enabled: boolean
      createdAt: number
      updatedAt: number
    },
    config: Record<string, unknown>,
  ): S
  /**
   * Optional live capability: browse recommended rooms for discovery UIs. Only
   * live sources implement this; RSS/YouTube are not expected to.
   */
  listRecommendRooms?(host: ProducerHost, page?: number): Promise<LiveRoomPage>
  /**
   * Built-in subscribable sources this adapter ships with (curated feeds,
   * channels, popular rooms). Consumers enumerate these for a "add subscription"
   * picker or CLI examples — no separate presets layer needed.
   */
  readonly builtinSubscriptions?: readonly BuiltinSubscription[]
}
