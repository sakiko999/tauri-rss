/**
 * BaseChannel — API 复刻渠道的默认实现。
 *
 * 子类只实现 `fetchItems(info)` 返回 `Item[]`,`fetch()` 自动序列化成 RSS 2.0
 * (+ tpl:) XML。这把"对外 XML 契约"实现一次,各平台只关心上游数据怎么归一。
 *
 * 原生 RSS 渠道不继承它(直接透传上游 XML,见 RawRssChannel)。
 */
import type { Item, Kind } from "@tauri-playground/xml"
import { serializeFeed, type SerializeOptions } from "@tauri-playground/xml"
import { canonicalSourceKey, type AnyRssSource, type SourceInfo } from "../index.ts"

export abstract class BaseChannel {
  abstract readonly key: string
  abstract readonly name: string
  /** 该 channel 产出的 item 默认 kind。 */
  abstract readonly kind: Kind

  /** 按参数缓存的 source 实例:相同参数复用同一实例。 */
  private readonly sourceCache = new Map<string, AnyRssSource>()

  /** 子类实现:拉上游数据 → 归一成 Item[]。 */
  protected abstract fetchItems(info: SourceInfo): Promise<Item[]>

  /** channel 元信息(标题/链接/描述),供 XML <channel>。 */
  protected channelOptions(_info: SourceInfo): SerializeOptions {
    return { channelTitle: this.name }
  }

  /** 默认可订阅参数。无参榜单默认 {};需用户输入的 channel 返回 undefined。 */
  readonly defaultInfo: SourceInfo | undefined = undefined

  /** 默认 source:fetchItems → serializeFeed。相同参数返回同一实例。 */
  getSource(info: SourceInfo): AnyRssSource {
    const key = canonicalSourceKey(info)
    let src = this.sourceCache.get(key)
    if (!src) {
      src = {
        fetch: async () => {
          const items = await this.fetchItems(info)
          return serializeFeed(items, this.channelOptions(info))
        },
      }
      this.sourceCache.set(key, src)
    }
    return src
  }
}
