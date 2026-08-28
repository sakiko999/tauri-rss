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
import { log } from "@tauri-playground/resolve"

/** serializeFeed + 可选 total(翻页渠道真实总数,经 tpl:total 带出)。apiFetch / fetchMore 共用。 */
export function serializeWithTotal(items: Item[], opts: SerializeOptions, total?: number): string {
  return serializeFeed(items, total !== undefined ? { ...opts, total } : opts)
}

/**
 * api channel 的 fetch 装配:抓 items → serializeFeed 成 RSS 2.0 XML。
 * 返回无参 `() => Promise<string>`,channel 在 getSource 里绑定 info 后塞进 source.fetch。
 * 仅挂失败 warn(`[crawler]` 域;成功路径日志已清退——CLI `rss fetch` 给结构化
 * 耗时/条数,见 docs/cli-plan.md §7)。失败 rethrow(调用方 core 编排层隔离单源失败)。
 */
export function apiFetch(
  fetchItems: () => Promise<Item[] | { items: Item[]; total?: number }>,
  channelOptions: () => SerializeOptions,
): () => Promise<string> {
  return async () => {
    const opts = channelOptions()
    try {
      // 兼容两种返回:Item[](旧) / { items, total }(翻页渠道带真实总数,如 weibo)。
      const r = await fetchItems()
      const items = Array.isArray(r) ? r : r.items
      const total = Array.isArray(r) ? undefined : r.total
      return serializeWithTotal(items, opts, total)
    } catch (e) {
      log.crawler.fetchError({ source: opts.channelTitle ?? "", message: (e as Error)?.message ?? String(e) })
      throw e
    }
  }
}

/**
 * api channel 的 fetchMore 装配:**数值游标**分页(起步 first、步进 step、本页为空即止)。
 * 镜像 apiFetch 的序列化/返回形状,把 4 个 hot channel 复制粘贴的翻页样板收敛到这。
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
    const items = await fetchPage(n)
    const xml = serializeFeed(items, o)
    return { xml, ...(items.length ? { cursor: String(n + opts.step) } : {}) }
  }
}

