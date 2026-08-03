/**
 * DataLayer — the single public seam between the app layer and the data layer.
 *
 * The app layer reads via `store`, calls `refresh()` to pull a subscription,
 * and `resolveLivePlay()` to lazily get a live room's playable URLs. Everything
 * else (adapters, host, repo) is an implementation detail.
 *
 * Default adapters are registered at construction: RSS and live rooms
 * (Bilibili/Douyu/Douyin/Huya). Custom adapters can still be added via
 * `registerAdapter`.
 */
import { NoAdapterError } from "./errors.ts"
import type { MediaItem } from "./types/media-item.ts"
import { createMediaStore, type MediaQuery } from "./store/media-store.ts"
import type { PlatformHost } from "./types/platform.ts"
import type { LivePlayUrl, RefreshResult } from "./types/result.ts"
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
import type { SourceAdapter } from "./source/source-adapter.ts"
import { BilibiliRankSource } from "./source/bilibili/bilibili-rank-source.ts"
import type { SubscriptionKind } from "./types/subscription.ts"
import { RssSource } from "./source/rss/rss-source.ts"
import { LiveSource } from "./live/shared/live-source.ts"
import { registerAllLiveSites } from "./live/platforms/index.ts"
import { getLiveSite } from "./live/index.ts"

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
}

export function createDataLayer(host: PlatformHost, options: DataLayerOptions = {}): DataLayer {
  const repo = createSubscriptionRepository(host)
  const reading = createReadingRepository(host)
  const settings = createSettingsRepository(host)
  const store = createMediaStore(options.now ?? host.now)
  const adapters = new Map<SubscriptionKind, SourceAdapter>()

  // Register live platforms in the registry (looked up by LiveSource).
  registerAllLiveSites(host)
  // Register default source adapters.
  const defaults: SourceAdapter[] = [
    new RssSource(),
    new LiveSource(),
    new BilibiliRankSource(),
  ]
  for (const a of defaults) adapters.set(a.kind, a)

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
      adapters.set(adapter.kind, adapter)
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
      const adapter = adapters.get(sub.kind)
      if (!adapter) throw new NoAdapterError(sub.kind)
      try {
        const items = await adapter.fetch(sub, host)
        store.replace(subscriptionId, items)
        return { subscriptionId, itemCount: items.length, fetchedAt: host.now() }
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
      if (!sub?.kind || sub.kind !== "live-room") {
        throw new Error(`subscription ${subscriptionId} is not a live-room`)
      }
      const site = getLiveSite(sub.platform)
      if (!site) throw new Error(`No LiveSite registered for platform: ${sub.platform}`)
      // resolveLivePlay needs detail + quality + urls — the multi-step resolve.
      const detail = await site.getRoomDetail(sub.roomId)
      const qualities = await site.getPlayQualities(detail)
      const best = qualities[0]
      if (!best) throw new Error(`No play qualities for room ${sub.roomId}`)
      return site.getPlayUrls(detail, best)
    },
  }
}
