/**
 * source 层 —— SourceProvider 热插拔插件抽象(4 层架构的 source 层聚合入口)。
 *
 * crawler/RSSHub(及未来的自研 sidecar 等)都是同一接口的源插件:crawler 是内置
 * provider(包 crawler 注册表),RSSHub 是运行时注册的外部 provider(import 副作用
 * 自注册,见 rsshub.ts)。新源零改 core 接入——实现 SourceProvider + 注册即可。
 *
 * 渠道契约直接复用 crawler 的 RssChannel 类型。core 本来就运行时依赖 crawler
 * 注册表，镜像 + `as unknown as` 只会让字段漂移在运行时才暴露；直接 import type
 * 让 tsc 在编译期兜底，零运行时成本。
 * 数据层(data-layer.ts)只经本模块取渠道,不直接碰 crawler 注册表。
 */
import { getChannel as getCrawlerChannel, listChannels as listCrawlerChannels } from "@amoeba/crawler"
import type { RssChannel } from "@amoeba/crawler"

export type { LoginCookieSnapshot, RssChannel, RssSource, SourceInfo, SourceInfoField } from "@amoeba/crawler"

/**
 * 源插件 —— 每源一个 provider,对外只声明渠道。
 * 热插拔语义 = 可注册可覆盖(registerSourceProvider 幂等,重复 id 后者覆盖);
 * 卸载无场景,不做 unregister。
 */
export interface SourceProvider {
  /** 源标识(调试/日志;如 "crawler" / "rsshub")。 */
  readonly id: string
  /** 本源全部渠道(AddFeedDialog 列表)。 */
  listChannels(): RssChannel[]
  /** 按 key 取渠道。 */
  getChannel(key: string): RssChannel | undefined
}

/** 内置 provider:包 crawler 注册表(其自身有惰性内置注册)。 */
const crawlerProvider: SourceProvider = {
  id: "crawler",
  listChannels: () => listCrawlerChannels(),
  getChannel: (key) => getCrawlerChannel(key),
}

// ── 聚合注册表 ───────────────────────────────────────────────────────────────

const providers: SourceProvider[] = [crawlerProvider]

/**
 * 注册源插件(幂等:同 id 覆盖)。外部源(rsshub 等)由 app 入口 import 触发模块
 * 副作用调用;crawler 内置,无需手动注册。
 */
export function registerSourceProvider(p: SourceProvider): void {
  const i = providers.findIndex((x) => x.id === p.id)
  if (i >= 0) providers[i] = p
  else providers.push(p)
}

/** 聚合取渠道:按注册序遍历 provider,首个命中(crawler 在前,rsshub 等后注册者兜底)。 */
export function getChannel(key: string): RssChannel | undefined {
  for (const p of providers) {
    const c = p.getChannel(key)
    if (c) return c
  }
  return undefined
}

/** 聚合渠道列表:全部 provider 拼接(内置在前,注册序)。 */
export function listChannels(): RssChannel[] {
  return providers.flatMap((p) => p.listChannels())
}

/** 已注册源 id(调试用)。 */
export function listSourceProviders(): string[] {
  return providers.map((p) => p.id)
}
