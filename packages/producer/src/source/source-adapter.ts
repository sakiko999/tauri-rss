/**
 * SourceAdapter — the seam between the producer's fetch adapters and the
 * maintainer (`createDataLayer`). Turns a `Subscription` into `MediaItem[]`.
 *
 * One concrete adapter per source kind (RSS, live, bilibili-rank). Adapters
 * receive the `ProducerHost` so they can issue CORS-free HTTP without importing
 * anything runtime-specific. Producers never import core — they only depend on
 * types within this package.
 */
import type { MediaItem } from "../types/media-item.ts"
import type { ProducerHost } from "../types/producer-host.ts"
import type { Subscription } from "../types/subscription.ts"

export interface SourceAdapter<S extends Subscription = Subscription> {
  /** Discriminator matching the subscription kind this adapter handles. */
  readonly kind: S["kind"]
  /** Pull the current set of items for a subscription. */
  fetch(subscription: S, host: ProducerHost): Promise<MediaItem[]>
}