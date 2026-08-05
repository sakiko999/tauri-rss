/**
 * SourceAdapter — the seam between the producer's fetch adapters and the
 * maintainer (`createDataLayer`). Turns a `Subscription` into `FeedItem[]`.
 *
 * `FeedItem` is the producer's *internal protocol* (see types/feed-item.ts) —
 * NOT the app content model. Core bridges FeedItem → its own MediaItem via
 * `feed-to-media.ts`; external consumers use `fetchXml` for pure RSS XML.
 *
 * One concrete adapter per source kind (RSS, live, bilibili-rank, bilibili,
 * youtube, or any plugin kind). Adapters receive the `ProducerHost` so they can
 * issue CORS-free HTTP without importing anything runtime-specific. Producers
 * never import core — they only depend on types within this package.
 *
 * Plugin model: a third-party platform implements `SourceAdapter` and registers
 * itself via `registerSource(new XxxSource())` — no changes to the built-in
 * subscription union or to core's data layer are required. The adapter's `kind`
 * is an open string (see `SubscriptionKind`); the optional `meta` lets the
 * registry be surfaced as a "supported platforms / add subscription" form.
 */
import type { FeedItem } from "../types/feed-item.ts"
import type { ProducerHost } from "../types/producer-host.ts"
import type { LivePlayUrl } from "../types/result.ts"
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

export interface SourceAdapter<S extends Subscription = Subscription> {
  /** Discriminator matching the subscription kind this adapter handles. */
  readonly kind: S["kind"]
  /** Display metadata (optional, for registry-driven UIs). */
  readonly meta?: SourceAdapterMeta
  /** Pull the current set of protocol items for a subscription. */
  fetch(subscription: S, host: ProducerHost): Promise<FeedItem[]>
  /**
   * Pure-XML external exit: fetch + serialize to RSS 2.0. Default = fetch then
   * `serializeFeed`. Consumers that only need the XML contract (any standard RSS
   * reader, external programs) use this; core's data path uses `fetch` to avoid
   * a needless serialize→deserialize round-trip.
   */
  fetchXml?(subscription: S, host: ProducerHost): Promise<string>
  /**
   * Optional capability: lazily resolve playable URLs. Only live-ish plugins
   * implement this; when absent, `DataLayer.resolveLivePlay` throws
   * "does not support resolveLivePlay".
   */
  resolveLivePlay?(subscription: S, host: ProducerHost): Promise<LivePlayUrl>
  /**
   * Optional factory: build a complete `Subscription` from form values. This is
   * the "external picks a channel → enters an id → gets a subscribe-able source
   * link" seam. `base` carries the fields every subscription needs (id, title,
   * enabled, timestamps); `config` carries the kind-specific values that match
   * `meta.configSchema`. When absent, the registry-driven UI falls back to a
   * generic `PluginSubscription` with config copied verbatim.
   */
  createSubscription?(
    base: {
      id: string
      title: string
      enabled: boolean
      createdAt: number
      updatedAt: number
    },
    config: Record<string, unknown>,
  ): S
}
