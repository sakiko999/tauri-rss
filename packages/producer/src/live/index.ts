/**
 * Live platform registry placeholder. Concrete platform adapters
 * (bilibili/douyu/huya/douyin) land in Phase 2 under `platforms/`.
 *
 * Registered via `registerLiveSite(site)` so `LiveSourceAdapter` can look one
 * up by platform id at refresh time.
 */
import type { FeedLivePlatformId } from "../types/feed-item.ts"
import type { LiveSite } from "./live-site.ts"

const sites = new Map<FeedLivePlatformId, LiveSite>()

export function registerLiveSite(site: LiveSite): void {
  sites.set(site.platform, site)
}

export function getLiveSite(platform: FeedLivePlatformId): LiveSite | undefined {
  return sites.get(platform)
}

export function listLiveSites(): LiveSite[] {
  return [...sites.values()]
}
