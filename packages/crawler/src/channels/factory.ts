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
import type { DanmakuPlayable, LivePlayable, Pageable, RssSource } from "../index.ts"
import { log } from "../log.ts"

/** serializeFeed + 可选 total(翻页渠道真实总数,经 tpl:total 带出)。apiFetch / fetchMore 共用。 */
export function serializeWithTotal(items: Item[], opts: SerializeOptions, total?: number): string {
  return serializeFeed(items, total !== undefined ? { ...opts, total } : opts)
}

/**
 * api channel 的 fetch 装配:抓 items → serializeFeed 成 RSS 2.0 XML。
 * 返回无参 `() => Promise<string>`,channel 在 getSource 里绑定 info 后塞进 source.fetch。
 * 统一挂抓取生命周期日志(`[crawler]` 域):开始 debug / 成功条数 info / 失败 warn。
 * 失败 rethrow(调用方 core 编排层隔离单源失败),channelTitle 作 source 标识。
 */
export function apiFetch(
  fetchItems: () => Promise<Item[] | { items: Item[]; total?: number }>,
  channelOptions: () => SerializeOptions,
): () => Promise<string> {
  return async () => {
    const opts = channelOptions()
    const source = opts.channelTitle ?? ""
    log.crawler.fetchStart({ source })
    try {
      // 兼容两种返回:Item[](旧) / { items, total }(翻页渠道带真实总数,如 weibo)。
      const r = await fetchItems()
      const items = Array.isArray(r) ? r : r.items
      const total = Array.isArray(r) ? undefined : r.total
      const xml = serializeWithTotal(items, opts, total)
      log.crawler.fetchOk({ source, count: items.length })
      return xml
    } catch (e) {
      log.crawler.fetchError({ source, message: (e as Error)?.message ?? String(e) })
      throw e
    }
  }
}

/**
 * api channel 的 fetchMore 装配:**数值游标**分页(起步 first、步进 step、本页为空即止)。
 * 镜像 apiFetch 的序列化/日志/返回形状,把 4 个 hot channel 复制粘贴的翻页样板收敛到这。
 * 只做通用机制;游标语义(页码 page / 偏移 offset)由调用方以 first/step 表达。
 */
export function apiFetchMore(
  fetchPage: (n: number) => Promise<Item[]>,
  channelOptions: () => SerializeOptions,
  opts: { first: number; step: number },
): (cursor?: string) => Promise<{ xml: string; cursor?: string }> {
  return async (cursor) => {
    const n = cursor ? Number(cursor) : opts.first
    const o = channelOptions()
    const source = o.channelTitle ?? ""
    log.crawler.fetchMore({ source, cursor })
    const items = await fetchPage(n)
    const xml = serializeFeed(items, o)
    log.crawler.fetchMoreOk({ source, count: items.length })
    return { xml, ...(items.length ? { cursor: String(n + opts.step) } : {}) }
  }
}

/**
 * hot channel 装配:热门源 fetch 是自家接口,懒解析/弹幕能力委托同平台 live source。
 * bili/douyin/douyu/huya 的 hot 都这个形态(对外独立 channel,机制复用主 channel)。
 * base 的 resolveLivePlay/getDanmaku 是自包含闭包(只捕获 info),直接透传省一层包装。
 */
export function liveHotSource(
  base: RssSource & LivePlayable & DanmakuPlayable,
  overrides: {
    fetch: () => Promise<string>
    /** 翻页能力(直播 hot 加载更多)。hot 源都支持分页,必传。 */
    fetchMore: (cursor?: string) => Promise<{ xml: string; cursor?: string }>
  },
): RssSource & LivePlayable & DanmakuPlayable & Pageable {
  return {
    fetch: overrides.fetch,
    fetchMore: overrides.fetchMore,
    resolveLivePlay: base.resolveLivePlay,
    getDanmaku: base.getDanmaku,
  }
}
