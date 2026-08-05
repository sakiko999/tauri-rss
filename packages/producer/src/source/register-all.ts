/**
 * Built-in source registration. Call `registerAllSources(host)` once at data-
 * layer construction so the adapter registry is populated. Plugins register
 * their own adapters in app startup via `registerSource(new XxxSource())` —
 * they need no change here, and no change to the subscription shape or to core.
 *
 * `host` is required because the live sources construct their platform sites
 * with it (their signing algorithms do HTTP + JS); non-live sources ignore it.
 */
import type { ProducerHost } from "../types/producer-host.ts"
import type { SourceAdapter } from "./source-adapter.ts"
import { registerSource } from "./registry.ts"
import { RssSource } from "./rss/rss-source.ts"
import { BilibiliSource } from "./bilibili/bilibili-source.ts"
import { YoutubeSource } from "./youtube/youtube-source.ts"
import { DouyuSource } from "./douyu/source.ts"
import { DouyinSource } from "./douyin/source.ts"
import { HuyaSource } from "./huya/source.ts"

/** Built-in source adapters. Live sources need the host; the rest ignore it. */
function builtinSources(host: ProducerHost): SourceAdapter[] {
  return [
    new RssSource(),
    new BilibiliSource(),
    new YoutubeSource(),
    new DouyuSource(host),
    new DouyinSource(host),
    new HuyaSource(host),
  ]
}

export function registerAllSources(host: ProducerHost): void {
  for (const source of builtinSources(host)) {
    registerSource(source)
  }
}
