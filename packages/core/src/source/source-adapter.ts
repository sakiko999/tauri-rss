/**
 * SourceAdapter — the seam that turns a `Subscription` into `MediaItem[]`.
 *
 * One concrete adapter per source kind (RSS, live). Adapters receive the
 * `PlatformHost` so they can issue CORS-free HTTP without importing anything
 * runtime-specific.
 */
import type { MediaItem } from "../types/media-item.ts"
import type { PlatformHost } from "../types/platform.ts"
import type { Subscription } from "../types/subscription.ts"

export interface SourceAdapter<S extends Subscription = Subscription> {
  /** Discriminator matching the subscription kind this adapter handles. */
  readonly kind: S["kind"]
  /** Pull the current set of items for a subscription. */
  fetch(subscription: S, host: PlatformHost): Promise<MediaItem[]>
}
