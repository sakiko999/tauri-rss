/**
 * BaseSource — default implementation for the common `SourceAdapter` surface.
 *
 * Every concrete source extends this so `toXml` (the first-class external
 * contract: subscription → RSS 2.0 XML) is implemented exactly once. A source
 * overrides it only to tweak the channel metadata (e.g. a live room's channel
 * link) or to skip fetching entirely (an adapter that always returns XML).
 */
import type { FeedItem } from "../types/feed-item.ts"
import type { ProducerHost } from "../types/producer-host.ts"
import type { Subscription } from "../types/subscription.ts"
import type { SourceAdapter } from "./source-adapter.ts"
import { serializeFeed, type SerializeOptions } from "./feed-serializer.ts"

export abstract class BaseSource<S extends Subscription = Subscription>
  implements SourceAdapter<S>
{
  abstract readonly sourceId: string
  abstract readonly meta?: SourceAdapter["meta"]
  abstract fetch(subscription: S, host: ProducerHost): Promise<FeedItem[]>

  /** Default external contract: fetch then serialize to RSS 2.0 (+ tpl:) XML. */
  async toXml(subscription: S, host: ProducerHost): Promise<string> {
    const items = await this.fetch(subscription, host)
    return serializeFeed(items, this.channelOptions(subscription))
  }

  /** Channel metadata for the default `toXml`. Override per source. */
  protected channelOptions(_subscription: S): SerializeOptions {
    return {}
  }
}
