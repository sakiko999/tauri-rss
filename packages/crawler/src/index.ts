/**
 * crawler —— 订阅源抓取层(producer 的重构替代)。
 *
 * 核心抽象:一切皆 RssChannel(渠道)。
 *   - channel 是**纯描述**:key/name/kind(默认 item kind)/sourceInfoTpl/defaultInfo;
 *   - `getSource(info)` 产出一个 source:只 `{ fetch }`,输出基础信息 XML
 *     (与 rsshub 一致)——**不再绑定流/弹幕解析能力**;
 *   - `source.fetch()` 直出 RSS 2.0 XML(标准子集);
 *   - 流/弹幕解析统一走 `resolver/`(按 item.url 路由到平台解析函数),
 *     对 crawler/rsshub 输出一起生效。
 *
 * 公共契约只有「渠道 → 参数 → XML」:XML 就是天然类型,下游(core / 任意
 * RSS 阅读器)自己解析 XML,不依赖 crawler 的任何数据模型类型。
 *
 * 注册:内置 channel 由 `ensureRegistered()` 惰性注册(见 register.ts),
 * `getChannel/listChannels/registerAllChannels` 都会先确保已注册。
 */
import { registerBuiltinChannels } from "./register.ts"
import type { Kind, Item } from "@tauri-playground/xml"

/** channel 产出的 item 种类。 */
export type { Kind } from "@tauri-playground/xml"

/** 宿主 HTTP 便捷层(httpText/httpJson/httpGet)——core source 层(rsshub 直传)复用。 */
export { httpGet, httpText, httpJson } from "@tauri-playground/resolve"

/** 渠道参数字段定义(描述实例化一个 source 需要什么)。 */
export type SourceInfo = Record<string, string>

/**
 * 可抓取的源实例(行为载体)。`fetch()` 直出 RSS 2.0 XML(标准子集)。
 * getSource 是纯函数:每次返回新实例,无缓存状态(复用/去重归 core 编排)。
 * 流/弹幕解析不在此——统一走 `resolver/`(by-url)。
 */
export interface RssSource {
  /** 抓取并返回 RSS 2.0 XML 字符串。 */
  fetch(): Promise<string>
}

/** 热搜词懒加载能力(可选能力,有该能力的 source 才 implements)。 */
export interface HotWordSource {
  /** 热搜词 → 该词下内容流(core 经 serializeFeed/deserializeFeed 消费,无需再进 XML 语义)。 */
  resolveHotWord(word: string): Promise<Item[]>
}

/** 单条详情能力(可选能力):列表 item 缺全文/多图时(如 xhs 列表只有单图摘要),按需抓详情。 */
export interface ItemDetailSource {
  /** 单条 → 完整详情 Item(xhs 匿名 GET /explore/<id>?xsec_token= 补全文/多图/tag/video)。 */
  resolveDetail(item: Item): Promise<Item | null>
}

/**
 * 扫码登录能力(可选能力,channel 级——平台账号登录,无需实例化 source)。
 * 登录是平台级操作,不依赖 info 实例化,且同平台多 channel(xhs:user/explore)共享同一账号。
 */
export interface Loginable {
  /**
   * 扫码登录。emitQr 回调把二维码 data URL 推给 UI(可空 = 还没出码)。
   * 成功后 cookie 已落浏览器 profile(Edge --user-data-dir 持久化),返回串
   * 供 core 落 settings(HTTP 降级路径复用)。无 appHost.browser 时抛错。
   */
  scanLogin(
    emitQr: (qrDataUrl: string | null) => void,
    opts?: { timeoutMs?: number },
  ): Promise<LoginResult>
}

/** 扫码登录结果。cookie 为 document.cookie 全量(含 web_session/a1/webId 等)。 */
export interface LoginResult {
  cookie: string
  user_id?: string
  /** 原本就已登录(未触发扫码即检测到),UI 据此提示而非展示新二维码。 */
  alreadyLoggedIn?: boolean
}

/** 翻页能力(可选能力):列表源(直播 hot 等)可翻页加载更多。 */
export interface Pageable {
  /**
   * 翻页:取下一页并返回新 XML + 下一页游标。
   * cursor 传上次返回的 cursor;首次翻页不传(取第 2 页)。返回的 cursor 省略 = 没有更多。
   */
  fetchMore(cursor?: string): Promise<{ xml: string; cursor?: string }>
}

/**
 * 类型谓词:运行时探测 + 编译期收窄,消费侧(如 core)能力判定一处定义。
 * 能力抽离后流/弹幕走 crawler/resolver(by-url),剩余谓词只覆盖
 * HotWordSource / Pageable / Loginable。
 */
export function isHotWordSource(s: RssSource): s is RssSource & HotWordSource {
  return "resolveHotWord" in s
}

/** item 单条详情能力探测(xhs 等列表 item 缺完整详情的源)。 */
export function isItemDetailSource(s: RssSource): s is RssSource & ItemDetailSource {
  return "resolveDetail" in s
}

export function isPageable(s: RssSource): s is RssSource & Pageable {
  return "fetchMore" in s
}

/** channel 级能力探测:该 channel 是否支持扫码登录。 */
export function isLoginable(c: RssChannel): c is RssChannel & Loginable {
  return "scanLogin" in c
}

/** 渠道参数字段(供 UI 生成"新增订阅"表单)。 */
export interface SourceInfoField {
  key: string
  label: string
  required?: boolean
  placeholder?: string
}

/**
 * 一个渠道 —— **纯描述**。`kind` 是默认 item kind(deserialize 兜底);
 * 实例化出的 source 才承担抓取与懒解析能力。
 */
export interface RssChannel {
  /** 渠道唯一 key(如 "bili:square"、"rss:hn")。 */
  readonly key: string
  /** 人类可读名称。 */
  readonly name: string
  /** 该 channel 产出的 item 默认 kind。item 自身 tpl:kind 可覆盖。 */
  readonly kind: Kind
  /** 实例化 source 需要的参数字段(供 UI 生成表单)。无参 channel 不声明。 */
  readonly sourceInfoTpl?: SourceInfoField[]
  /**
   * 带默认参数的实例(可选)。存在 = 无需用户输入即可订阅一个合理实例
   * (如内置 RSS 的 url、live:douyu 的 roomId)。**无参 channel 不声明**
   * ——「无需输入即可订阅」由 empty info 表达,不必用 `{}` 占位。
   */
  readonly defaultInfo?: SourceInfo
  /** 按 info(url/uid/…)实例化一个可抓取的 source(行为载体);返回类型可按需收窄成 RssSource & VideoPlayable 等。 */
  getSource(info: SourceInfo): RssSource
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

