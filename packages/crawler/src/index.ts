/**
 * crawler —— 订阅源抓取层(producer 的重构替代)。
 *
 * 核心抽象:一切皆 RssChannel(渠道)。
 *   - channel 用 `sourceInfoTpl` 描述实例化一个 source 需要什么参数;
 *   - `getSource(info)` 工厂,按参数(url / uid / roomId)产出一个 source;
 *   - `source.fetch()` 直出 RSS 2.0 XML 字符串(标准子集 + `tpl:` 扩展)。
 *
 * 公共契约只有「渠道 → 参数 → XML」:XML 就是天然类型,下游(core / 任意
 * RSS 阅读器)自己解析 XML,不依赖 crawler 的任何数据模型类型。
 *
 * 注册:内置 channel 由 `ensureRegistered()` 惰性注册(见 register.ts),
 * `getChannel/listChannels/registerAllChannels` 都会先确保已注册。
 */
import { registerBuiltinChannels } from "./register.ts"
import type { Kind, Stream } from "@tauri-playground/xml"

/** channel 产出的 item 种类。 */
export type { Kind } from "@tauri-playground/xml"

/** 渠道参数字段定义(描述实例化一个 source 需要什么)。 */
export type SourceInfo = Record<string, string>

/** 参数规范化为缓存 key:按 key 排序后 JSON.stringify,保证 {a,b}/{b,a} 同 key。 */
export function canonicalSourceKey(info: SourceInfo): string {
  return JSON.stringify(Object.keys(info).sort().map((k) => [k, info[k]]))
}

/**
 * 一个可抓取的源实例。`fetch()` 直出 RSS 2.0 XML(标准子集 + `tpl:` 扩展)。
 */
export interface RssSource {
  /** 抓取并返回 RSS 2.0 XML 字符串。 */
  fetch(): Promise<string>
}

/**
 * 视频源的懒解析扩展(可选能力,不放基类)。
 * 播放 URL 通常带 expiry 签名,须在播放时调用而非塞进 refresh 快照。
 */
export interface RssVideoSource extends RssSource {
  /** 按 item id(如 bvid)懒解析可播流。 */
  resolvePlay?(itemId: string): Promise<Stream[]>
}

/** 直播源的懒解析扩展(可选能力,不放基类)。 */
export interface RssLiveSource extends RssSource {
  /** 按 roomId 懒解析可播流。 */
  resolveLivePlay?(roomId: string): Promise<Stream[]>
}

/** getSource 的返回:基础抓取 + 可选懒解析能力。 */
export type AnyRssSource = RssSource | RssVideoSource | RssLiveSource

/** 渠道参数字段(供 UI 生成"新增订阅"表单)。 */
export interface SourceInfoField {
  key: string
  label: string
  required?: boolean
  placeholder?: string
}

/**
 * 一个渠道:用 `sourceInfoTpl` 描述参数,`getSource(info)` 按 info 实例化 source。
 */
export interface RssChannel {
  /** 渠道唯一 key(如 "bili:rank"、"rss:hn")。 */
  readonly key: string
  /** 人类可读名称。 */
  readonly name: string
  /** 该 channel 产出的 item 默认 kind。item 自身 tpl:kind 可覆盖。 */
  readonly kind: Kind
  /** 实例化 source 需要的参数字段(供 UI 生成表单)。 */
  readonly sourceInfoTpl?: SourceInfoField[]
  /**
   * 默认可订阅参数(可选)。存在 = 无需用户输入即可订阅一个合理实例
   * (如内置 RSS 的 url、无参榜单);缺失 = 需要用户提供参数(如 uid/roomId)。
   */
  readonly defaultInfo?: SourceInfo
  /** 按 info(url/uid/…)实例化一个 source。 */
  getSource(info: SourceInfo): AnyRssSource
}

// ── channel 注册表 ───────────────────────────────────────────────────────────

const CHANNELS = new Map<string, RssChannel>()

/** 内置注册守卫:首次访问时注册内置 channel,之后 no-op。 */
let builtinRegistered = false

function ensureBuiltinRegistered(): void {
  if (builtinRegistered) return
  builtinRegistered = true
  registerBuiltinChannels()
}

/** 注册一个渠道。重复 key 覆盖。 */
export function registerChannel(channel: RssChannel): void {
  CHANNELS.set(channel.key, channel)
}

/** 按 key 取渠道(未注册时惰性触发内置注册)。 */
export function getChannel(key: string): RssChannel | undefined {
  ensureBuiltinRegistered()
  return CHANNELS.get(key)
}

/** 列出全部已注册渠道(未注册时惰性触发内置注册)。 */
export function listChannels(): RssChannel[] {
  ensureBuiltinRegistered()
  return [...CHANNELS.values()]
}

/** 显式触发内置渠道注册(幂等)。 */
export function registerAllChannels(): void {
  ensureBuiltinRegistered()
}

/** 仅测试用:清空注册表与内置注册守卫(下次访问会重新注册内置)。 */
export function __resetChannels(): void {
  CHANNELS.clear()
  builtinRegistered = false
}
