/**
 * DataLayer — the single public seam between the app layer and the data layer.
 *
 * The app layer reads via `store`, calls `refresh()` to pull a subscription,
 * and `resolveLivePlay()` to lazily get a live room's playable URLs. Everything
 * else (adapters, host, repo) is an implementation detail.
 *
 * Built-in source adapters are registered into the producer registry via
 * `registerAllSources()`; this snapshots that registry into the adapter map.
 * Plugins register via `registerSource(new XxxSource())` at app startup — they
 * need no change here. `resolveLivePlay` dispatches to the adapter's optional
 * `resolveLivePlay` capability.
 */
import { NoAdapterError } from "./errors.ts"
import type { MediaItem } from "./types/media-item.ts"
import { createMediaStore, type MediaQuery } from "./store/media-store.ts"
import type { PlatformHost } from "./types/platform.ts"
import type { FeedStream, LivePlayUrl, RefreshResult } from "@tauri-playground/producer"
import {
  createSubscriptionRepository,
  type SubscriptionRepository,
} from "./repo/subscription-repository.ts"
import {
  createReadingRepository,
  type ReadingRepository,
} from "./repo/reading-repository.ts"
import {
  createSettingsRepository,
  type SettingsRepository,
} from "./repo/settings-repository.ts"
import { feedItemsToMediaItems } from "./feed-to-media.ts"
import type { SourceAdapter } from "@tauri-playground/producer"
import { deserializeFeed, registerAllSources, listSources } from "@tauri-playground/producer"

export interface DataLayerOptions {
  /** Custom clock (defaults to host.now). */
  now?: () => number
}

export interface DataLayer {
  /** Subscription config (CRUD). */
  readonly subscriptions: SubscriptionRepository
  /** Read-state (mark read / playback position). */
  readonly reading: ReadingRepository
  /** App settings. */
  readonly settings: SettingsRepository
  /** Content store (query + observe). */
  readonly store: {
    all(): MediaItem[]
    query(query?: MediaQuery): MediaItem[]
    patch(id: string, patch: Partial<MediaItem>): void
    subscribe(listener: () => void): () => void
  }
  /** Register an additional source adapter for a subscription kind. */
  registerAdapter(adapter: SourceAdapter): void
  /** Refresh one subscription, writing its items into the store. */
  refresh(subscriptionId: string): Promise<RefreshResult>
  /** Lazily resolve a live room's playable URLs (live scope). */
  resolveLivePlay(subscriptionId: string): Promise<LivePlayUrl>
  /** Lazily resolve a video item's playable streams (item-scoped by videoId). */
  resolveVideoPlay(subscriptionId: string, videoId: string): Promise<FeedStream[]>
}

export function createDataLayer(host: PlatformHost, options: DataLayerOptions = {}): DataLayer {
  const repo = createSubscriptionRepository(host)
  const reading = createReadingRepository(host)
  const settings = createSettingsRepository(host)
  const store = createMediaStore(options.now ?? host.now)
  const adapters = new Map<string, SourceAdapter>()

  // Register built-in source adapters (idempotent), then snapshot the registry
  // into the adapter map. Plugins registered via registerSource() before this
  // call are picked up here too.
  registerAllSources(host)
  for (const a of listSources()) adapters.set(a.sourceId, a)

  return {
    subscriptions: repo,
    reading,
    settings,
    store: {
      all: () => store.all(),
      query: (q) => store.query(q),
      patch: (id, patch) => store.patch(id, patch),
      subscribe: (l) => store.subscribe(l),
    },

    registerAdapter(adapter) {
      adapters.set(adapter.sourceId, adapter)
    },

    async refresh(subscriptionId) {
      const sub = await repo.get(subscriptionId)
      if (!sub) {
        return {
          subscriptionId,
          itemCount: 0,
          error: "subscription not found",
          fetchedAt: host.now(),
        }
      }
      const adapter = adapters.get(sub.sourceId)
      if (!adapter) throw new NoAdapterError(sub.sourceId)
      try {
        // The producer↔core transfer is XML: every source satisfies `toXml`,
        // so core consumes uniform RSS 2.0 (+ tpl:) and recovers the protocol
        // items via `deserializeFeed`.
        const xml = await adapter.toXml(sub, host)
        const items = deserializeFeed(xml)
        const mediaItems = feedItemsToMediaItems(items, {
          subscriptionId,
          now: host.now(),
        })
        store.replace(subscriptionId, mediaItems)
        return { subscriptionId, itemCount: mediaItems.length, fetchedAt: host.now() }
      } catch (err) {
        host.log.log("error", "refresh failed", { subscriptionId, error: String(err) })
        return {
          subscriptionId,
          itemCount: 0,
          error: err instanceof Error ? err.message : String(err),
          fetchedAt: host.now(),
        }
      }
    },

    async resolveLivePlay(subscriptionId) {
      const sub = await repo.get(subscriptionId)
      if (!sub) throw new Error(`subscription ${subscriptionId} not found`)
      const adapter = adapters.get(sub.sourceId)
      if (!adapter) throw new NoAdapterError(sub.sourceId)
      if (!adapter.resolveLivePlay) {
        throw new Error(`subscription source ${sub.sourceId} does not support resolveLivePlay`)
      }
      return adapter.resolveLivePlay(sub, host)
    },

    async resolveVideoPlay(subscriptionId, videoId) {
      const sub = await repo.get(subscriptionId)
      if (!sub) throw new Error(`subscription ${subscriptionId} not found`)
      const adapter = adapters.get(sub.sourceId)
      if (!adapter) throw new NoAdapterError(sub.sourceId)
      if (!adapter.resolveVideoPlay) {
        throw new Error(`subscription source ${sub.sourceId} does not support resolveVideoPlay`)
      }
      return adapter.resolveVideoPlay(sub, host, videoId)
    },
  }
}
