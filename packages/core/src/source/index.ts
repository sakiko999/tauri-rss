/**
 * source 层 —— SourceProvider 热插拔插件抽象(4 层架构的 source 层聚合入口)。
 *
 * crawler/RSSHub(及未来的自研 sidecar 等)都是同一接口的源插件:crawler 是内置
 * provider(包 crawler 注册表),RSSHub 是运行时注册的外部 provider(import 副作用
 * 自注册,见 rsshub.ts)。新源零改 core 接入——实现 SourceProvider + 注册即可。
 *
 * 渠道契约复用 crawler 的 RssChannel 形状(鸭子类型,core 不 import crawler 类型
 * ——与 LoginResult 同款「结构兼容」边界;RssChannel/SourceInfoField 在此镜像声明)。
 * 数据层(data-layer.ts)只经本模块取渠道,不直接碰 crawler 注册表。
 */
import {
  listChannels as listCrawlerChannels,
  getChannel as getCrawlerChannel,
} from "@tauri-playground/crawler"
import type { MediaKind } from "../types/media-item.ts"

/** 订阅参数字段描述(供 UI 生成表单)。结构兼容 crawler 的 SourceInfoField。 */
export interface SourceInfoField {
  key: string
  label: string
  required?: boolean
  placeholder?: string
}

/** 订阅实例化参数(Record 形状,与 crawler SourceInfo 一致)。 */
export type SourceInfo = Record<string, string>

/**
 * 一个渠道 —— 纯描述(kind 是 item 默认 kind);getSource 才承担抓取与懒解析能力。
 * 结构兼容 crawler 的 RssChannel;能力(VideoPlayable 等)照旧在 getSource 返回对象
 * 上以 `in` 谓词探测(数据层已有 isRssVideoSource 等)。
 */
export interface RssChannel {
  /** 渠道唯一 key(源内唯一;建议带源前缀如 "rsshub:*" 防跨源冲突)。 */
  readonly key: string
  /** 人类可读名称。 */
  readonly name: string
  /** 该 channel 产出的 item 默认 kind。 */
  readonly kind: MediaKind
  /** 实例化 source 需要的参数字段。无参 channel 不声明。 */
  readonly sourceInfoTpl?: SourceInfoField[]
  /** 带默认参数的实例(可选;存在 = 无需输入即可订阅)。 */
  readonly defaultInfo?: SourceInfo
  /** 按 info(url/uid/…)实例化一个可抓取的 source。 */
  getSource(info: SourceInfo): RssSource
}

/** source 最小契约:fetch 直出 RSS 2.0 XML 字符串。 */
export interface RssSource {
  fetch(): Promise<string>
}

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
  listChannels: () => listCrawlerChannels() as unknown as RssChannel[],
  getChannel: (key) => getCrawlerChannel(key) as unknown as RssChannel | undefined,
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
