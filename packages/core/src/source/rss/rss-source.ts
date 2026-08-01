/**
 * RssSource — fetches a direct RSS/Atom feed URL and emits `ArticleItem`s.
 */
import type { MediaItem } from "../../types/media-item.ts"
import type { PlatformHost } from "../../types/platform.ts"
import type { RssSubscription } from "../../types/subscription.ts"
import type { SourceAdapter } from "../source-adapter.ts"
import { feedToArticles } from "./rss-to-items.ts"
import { parseFeed } from "./xml-parser.ts"

export class RssSource implements SourceAdapter<RssSubscription> {
  readonly kind = "rss" as const

  async fetch(subscription: RssSubscription, host: PlatformHost): Promise<MediaItem[]> {
    const res = await host.http.request({
      url: subscription.url,
      method: "GET",
      responseType: "text",
      headers: { "user-agent": UA },
    })
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`RSS fetch failed: ${res.status} for ${subscription.url}`)
    }
    const xml = typeof res.body === "string" ? res.body : new TextDecoder().decode(res.body)
    const feed = parseFeed(xml)
    return feedToArticles(feed, {
      subscriptionId: subscription.id,
      sourceId: "rss",
      fetchedAt: host.now(),
      feedTitle: feed.channel.title ?? subscription.title,
    })
  }
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
