/**
 * source 装配辅助。
 *
 * channel 在 getSource(info) 里直接拼 source 对象字面量:fetch 必备,
 * 可选 implements VideoPlayable / LivePlayable(能力由 channel 实现,按需声明)。
 * 这里只提供 fetch 的两种装配方式,不介入能力声明。
 *
 *   - api channel(items → serializeFeed → XML):用 `apiFetch` 包出 fetch;
 *   - 原生直传(上游已是 XML):channel 自行 `() => this.fetchXml(info)`。
 */
import type { Item, SerializeOptions } from "@tauri-playground/xml"
import { serializeFeed } from "@tauri-playground/xml"
import type { DanmakuPlayable, LivePlayable, RssSource } from "../index.ts"

/**
 * api channel 的 fetch 装配:抓 items → serializeFeed 成 RSS 2.0 XML。
 * 返回无参 `() => Promise<string>`,channel 在 getSource 里绑定 info 后塞进 source.fetch。
 */
export function apiFetch(
  fetchItems: () => Promise<Item[]>,
  channelOptions: () => SerializeOptions,
): () => Promise<string> {
  return async () => serializeFeed(await fetchItems(), channelOptions())
}

/**
 * hot channel 装配:热门源 fetch 是自家接口,懒解析/弹幕能力委托同平台 live source。
 * bili/douyin/douyu/huya 的 hot 都这个形态(对外独立 channel,机制复用主 channel)。
 */
export function liveHotSource(
  base: RssSource & LivePlayable & DanmakuPlayable,
  overrides: { fetch: () => Promise<string> },
): RssSource & LivePlayable & DanmakuPlayable {
  return {
    fetch: overrides.fetch,
    resolveLivePlay: (roomId) => base.resolveLivePlay(roomId),
    getDanmaku: (roomId) => base.getDanmaku(roomId),
  }
}
