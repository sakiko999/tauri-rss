/**
 * RssSource — fetches a direct RSS/Atom feed URL and emits `FeedArticle`s.
 */
import type { FeedItem } from "../../types/feed-item.ts"
import type { ProducerHost } from "../../types/producer-host.ts"
import type { RssSubscription } from "../../types/subscription.ts"
import { BaseSource } from "../base-source.ts"
import { RSS_BUILTIN_FEEDS } from "./builtin-feeds.ts"
import { feedToArticles } from "../../parse/rss-to-items.ts"
import { parseFeed } from "../../parse/xml-parser.ts"

export class RssSource extends BaseSource<RssSubscription> {
  readonly sourceId = "rss" as const
  readonly meta = {
    name: "RSS / Atom 订阅",
    description: "任意原生 feed URL",
    configSchema: [
      { key: "url", label: "Feed URL", type: "text" as const, required: true },
    ],
  }

  /** Curated public RSS/Atom feeds this source ships with. */
  readonly builtinSubscriptions = RSS_BUILTIN_FEEDS

  /** Build a subscription from form values: config.url → RssSubscription.config. */
  createSubscription(
    base: { id: string; sourceId: string; title: string; enabled: boolean; createdAt: number; updatedAt: number },
    config: Record<string, unknown>,
  ): RssSubscription {
    return { ...base, sourceId: "rss", config: { url: String(config.url ?? "") } }
  }

  async fetch(subscription: RssSubscription, host: ProducerHost): Promise<FeedItem[]> {
    const url = subscription.config.url
    const res = await host.http.request({
      url,
      method: "GET",
      responseType: "text",
      headers: { "user-agent": UA },
    })
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`RSS fetch failed: ${res.status} for ${url}`)
    }
    const xml = typeof res.body === "string" ? res.body : new TextDecoder().decode(res.body)
    const feed = parseFeed(xml)
    return feedToArticles(feed, {
      sourceId: "rss",
      fetchedAt: host.now(),
      feedTitle: feed.channel.title ?? subscription.title,
    })
  }
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
