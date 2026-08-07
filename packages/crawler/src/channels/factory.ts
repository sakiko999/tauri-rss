/**
 * channel 组合工厂 —— 装配 RssSource 的纯函数。
 *
 * 每个「info → RssSource」的 channel 用它装配 getSource:
 *   getSource 是无状态纯函数,每次返回新 RssSource 实例。
 * 「相同 info 复用同一实例 / 去重」是 core 编排层的事(core 若需要可自持缓存),
 * crawler 不为所有消费者强加缓存状态。
 *
 * 懒解析能力(resolvePlay/resolveLivePlay)挂在 source 上(行为载体):
 *   有能力就把对应函数作为 factory 的 capabilities 传入,装配出的 source
 *   带该能力;没能力就不传,source 只有 fetch。消费方用
 *   `isRssVideoSource/isRssLiveSource` 探测。
 */
import type { Item } from "@tauri-playground/xml"
import { serializeFeed, type SerializeOptions } from "@tauri-playground/xml"
import type { AnyRssSource, RssSource, SourceInfo } from "../index.ts"

/** 懒解析能力集(可选)。有能力的 channel 传对应函数。 */
export interface SourceCapabilities {
  resolvePlay?(itemId: string): Promise<import("@tauri-playground/xml").Stream[]>
  resolveLivePlay?(roomId: string): Promise<import("@tauri-playground/xml").Stream[]>
}

/** 最小编源原语:info → 新 RssSource 实例(fetch 直接透传 fetchXml)。无状态。 */
export function createSource(
  fetchXml: (info: SourceInfo) => Promise<string>,
  caps: SourceCapabilities = {},
): (info: SourceInfo) => AnyRssSource {
  return (info) => {
    const source: RssSource = { fetch: () => fetchXml(info) }
    if (caps.resolvePlay) (source as RssSource & typeof caps).resolvePlay = caps.resolvePlay
    if (caps.resolveLivePlay) (source as RssSource & typeof caps).resolveLivePlay = caps.resolveLivePlay
    return source as AnyRssSource
  }
}

/** API 复刻 channel 专用:fetchItems → serializeFeed 装配。无状态。 */
export function createApiSource(
  fetchItems: (info: SourceInfo) => Promise<Item[]>,
  channelOptions: (info: SourceInfo) => SerializeOptions,
  caps: SourceCapabilities = {},
): (info: SourceInfo) => AnyRssSource {
  return createSource(async (info) => serializeFeed(await fetchItems(info), channelOptions(info)), caps)
}
