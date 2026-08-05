/**
 * Built-in source registration. Call `registerAllSources()` once at data-layer
 * construction so the adapter registry is populated. Plugins register their own
 * adapters in app startup via `registerSource(new XxxSource())` — they need no
 * change here, and no change to the subscription union or to core.
 *
 * Note: unlike `registerAllLiveSites(host)`, this needs no host — source
 * adapters are constructed with no arguments (live sites need the host because
 * their signing algorithms do HTTP).
 */
import { registerSource } from "./registry.ts"
import { RssSource } from "./rss/rss-source.ts"
import { LiveSource } from "../live/shared/live-source.ts"
import { BilibiliRankSource } from "./bilibili/bilibili-rank-source.ts"
import { BilibiliSource } from "./bilibili/bilibili-source.ts"
import { YoutubeSource } from "./youtube/youtube-source.ts"

export function registerAllSources(): void {
  registerSource(new RssSource())
  registerSource(new LiveSource())
  registerSource(new BilibiliRankSource())
  registerSource(new BilibiliSource())
  registerSource(new YoutubeSource())
}
