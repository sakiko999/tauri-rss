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
import type { Item, SerializeOptions } from "@amoeba/xml"
import { serializeFeed } from "@amoeba/xml"
import { formatError, log } from "@amoeba/resolve"
import type { Kind, Loginable, Pageable, RssChannel, RssSource, SourceInfo, SourceInfoField } from "../index.ts"

/** serializeFeed + 可选 total(翻页渠道真实总数,经 tpl:total 带出)。apiFetch / fetchMore 共用。 */
export function serializeWithTotal(items: Item[], opts: SerializeOptions, total?: number): string {
  return serializeFeed(items, total !== undefined ? { ...opts, total } : opts)
}

/** api channel 抓取的唯一返回形状(翻页渠道可带真实总数)。 */
export interface FetchResult {
  items: Item[]
  /** 上游给出的真实总数(经 tpl:total 带出);未知则省略。 */
  total?: number
}

/**
 * api channel 的 fetch 装配:抓 items → serializeFeed 成 RSS 2.0 XML。
 * 返回无参 `() => Promise<string>`,channel 在 getSource 里绑定 info 后塞进 source.fetch。
 * 仅挂失败 warn(`[crawler]` 域;成功路径日志已清退——CLI `rss fetch` 给结构化
 * 耗时/条数,见 docs/cli-plan.md §7)。失败 rethrow(调用方 core 编排层隔离单源失败)。
 */
export function apiFetch(
  fetchResult: () => Promise<FetchResult>,
  channelOptions: () => SerializeOptions,
): () => Promise<string> {
  return async () => {
    const opts = channelOptions()
    try {
      const { items, total } = await fetchResult()
      return serializeWithTotal(items, opts, total)
    } catch (e) {
      log.crawler.fetchError({ source: opts.channelTitle ?? "", message: formatError(e) })
      throw e
    }
  }
}

/**
 * 无 total 的渠道(大多数)适配到统一 `FetchResult`。
 * 新增 api channel 默认用它;只有需要把上游总数带到 `tpl:total` 时才直接用 apiFetch。
 */
export function apiFetchItems(
  fetchItems: () => Promise<Item[]>,
  channelOptions: () => SerializeOptions,
): () => Promise<string> {
  return apiFetch(async () => ({ items: await fetchItems() }), channelOptions)
}

/**
 * 「单端点 GET → 列表 → 映射」同形渠道的声明式规格。
 * getSource 接线(fetch / fetchMore)与 channelOptions 样板由 makeApiChannel 收敛,
 * 渠道文件只剩 key/name/kind/tpl + fetchPage 纯映射(cookie 等凭据在 fetchPage 闭包
 * 里从 info 取一次,不再散落)。
 */
export interface ApiChannelSpec {
  key: string
  name: string
  kind: Kind
  /** 实例化参数表单(供 UI);无参渠道不声明。 */
  sourceInfoTpl?: SourceInfoField[]
  /** 无需用户输入即可订阅的默认参数;无参渠道不声明。 */
  defaultInfo?: SourceInfo
  /** 平台级扫码登录(popular 等 Loginable 渠道);结构兼容,isLoginable 据此探测。 */
  scanLogin?: Loginable["scanLogin"]
  /** 启动快照(浏览器登录的渠道);结构兼容,core 按方法存在性探测。 */
  readLoginCookie?: RssChannel["readLoginCookie"]
  /** 频道标题与链接(链接可为常量或按 info 生成)。 */
  channelTitle: (info: SourceInfo) => string
  channelLink: string | ((info: SourceInfo) => string)
  /** 取第 page 页条目(页码从 1 起)。过滤空页的渠道返回 `{ items, hasMore }`(见下)。 */
  fetchPage: (info: SourceInfo, page: number) => Promise<Item[] | { items: Item[]; hasMore?: boolean }>
  /** 数值翻页(省略 = 单页无翻页)。first:首页之后的起始页;step:页步进。 */
  pageable?: { first: number; step: number }
}

/**
 * 声明式 api channel 装配。15+ 渠道曾各自手写同一套
 * `getSource(info){ apiFetchItems(...); apiFetchMore(...) }` + `channelOptions`
 * 样板,凭据传递靠每个调用点「记得」(bili:user_video / favlist / douyinCookie
 * 三次漏传案底)——接线收敛到这一处后,渠道差异只剩 fetchPage 映射。
 * 有真差异的渠道(多房间聚合、动态结构映射、搜索候选、输入→id 联网 memo)
 * 保留类实现;xhs 的 base/shared 是另一极(浏览器策略层),不适用本工厂。
 */
export function makeApiChannel(spec: ApiChannelSpec): RssChannel {
  const channelOptions = (info: SourceInfo): SerializeOptions => ({
    channelTitle: spec.channelTitle(info),
    channelLink: typeof spec.channelLink === "string" ? spec.channelLink : spec.channelLink(info),
  })
  const source = (info: SourceInfo): RssSource & Partial<Pageable> => {
    // fetchPage 的联合返回(Item[] | {items,hasMore})归一到 FetchResult(apiFetch 的形状)。
    const fetchResult = async () => {
      const r = await spec.fetchPage(info, 1)
      return Array.isArray(r) ? { items: r } : r
    }
    const fetch = apiFetch(fetchResult, () => channelOptions(info))
    if (!spec.pageable) return { fetch }
    return {
      fetch,
      fetchMore: apiFetchMore((page) => spec.fetchPage(info, page), () => channelOptions(info), spec.pageable),
    }
  }
  // scanLogin 挂渠道级(isLoginable 按 "scanLogin" in c 探测);其余字段逐 spec 透传。
  return {
    key: spec.key,
    name: spec.name,
    kind: spec.kind,
    ...(spec.sourceInfoTpl ? { sourceInfoTpl: spec.sourceInfoTpl } : {}),
    ...(spec.defaultInfo ? { defaultInfo: spec.defaultInfo } : {}),
    getSource: source,
    ...(spec.scanLogin ? { scanLogin: spec.scanLogin } : {}),
    ...(spec.readLoginCookie ? { readLoginCookie: spec.readLoginCookie } : {}),
  } as RssChannel
}

/**
 * api channel 的 fetchMore 装配:**数值游标**分页(起步 first、步进 step、本页为空即止)。
 * 镜像 apiFetch 的序列化/返回形状,把 4 个 hot channel 复制粘贴的翻页样板收敛到这。
 * 只做通用机制;游标语义(页码 page / 偏移 offset)由调用方以 first/step 表达。
 *
 * ⚠️ 默认「本页 0 条 ⇒ 没有更多」,但**过滤过条目的渠道**(如 `bili:favlist` 跳过
 * `attr != 0` 的失效视频)不能靠它 —— 某一页恰好全是失效条目时会被误判成到底,
 * 后面的页永远取不到。这类渠道返回 `{ items, hasMore }` 让上游字段说话。
 */
export function apiFetchMore(
  fetchPage: (n: number) => Promise<Item[] | { items: Item[]; hasMore?: boolean }>,
  channelOptions: () => SerializeOptions,
  opts: { first: number; step: number },
): (cursor?: string) => Promise<{ xml: string; cursor?: string }> {
  return async (cursor) => {
    const n = cursor ? Number(cursor) : opts.first
    const o = channelOptions()
    // 翻页失败也要留痕(与 apiFetch 对等):否则 loadMore 静默失败,UI 只表现为「没有更多」。
    try {
      const r = await fetchPage(n)
      const items = Array.isArray(r) ? r : r.items
      const hasMore = Array.isArray(r) ? undefined : r.hasMore
      const xml = serializeFeed(items, o)
      return {
        xml,
        ...((hasMore ?? items.length > 0) ? { cursor: String(n + opts.step) } : {}),
        // 把上游的「还有下一页」透出去:本页被过滤空时 core 靠它才不会判成到底。
        ...(hasMore !== undefined ? { hasMore } : {}),
      }
    } catch (e) {
      log.crawler.fetchError({ source: o.channelTitle ?? "", message: formatError(e) })
      throw e
    }
  }
}

