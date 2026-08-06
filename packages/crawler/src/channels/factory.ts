/**
 * channel 组合工厂 —— 装配 RssSource 的纯函数。
 *
 * 每个「info → RssSource」的 channel 用它装配 getSource:
 *   getSource 是无状态纯函数,每次返回新 RssSource 实例。
 * 「相同 info 复用同一实例 / 去重」是 core 编排层的事(core 若需要可自持缓存),
 * crawler 不为所有消费者强加缓存状态。
 * 懒解析能力(resolvePlay/resolveLivePlay)仍是 channel 自身方法(implements 接口),
 * 与 getSource 无关。
 */
import type { Item } from "@tauri-playground/xml"
import { serializeFeed, type SerializeOptions } from "@tauri-playground/xml"
import type { RssSource, SourceInfo } from "../index.ts"

/** 最小编源原语:info → 新 RssSource 实例(fetch 直接透传 fetchXml)。无状态。 */
export function createSource(
  fetchXml: (info: SourceInfo) => Promise<string>,
): (info: SourceInfo) => RssSource {
  return (info) => ({ fetch: () => fetchXml(info) })
}

/** API 复刻 channel 专用:fetchItems → serializeFeed 装配。无状态。 */
export function createApiSource(
  fetchItems: (info: SourceInfo) => Promise<Item[]>,
  channelOptions: (info: SourceInfo) => SerializeOptions,
): (info: SourceInfo) => RssSource {
  return createSource(async (info) => serializeFeed(await fetchItems(info), channelOptions(info)))
}
