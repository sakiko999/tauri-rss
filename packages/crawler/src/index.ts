/**
 * crawler —— 订阅源抓取层(producer 的重构替代)。
 *
 * 核心抽象:一切皆 RssChannel(渠道)。
 *   - channel 是**纯描述**:key/name/kind(默认 item kind)/sourceInfoTpl/defaultInfo;
 *   - `getSource(info)` 产出一个 source(行为载体)——channel 直接拼装对象字面量,
 *     用 `implements` 声明它具备哪些能力;
 *   - `source.fetch()` 直出 RSS 2.0 XML(标准子集 + `tpl:` 扩展);
 *   - 懒解析能力(resolvePlay/resolveLivePlay)是 **source 的能力**,由它在
 *     `getSource` 里实现的 interface 决定。消费方用类型谓词探测后收窄。
 *
 * 公共契约只有「渠道 → 参数 → XML」:XML 就是天然类型,下游(core / 任意
 * RSS 阅读器)自己解析 XML,不依赖 crawler 的任何数据模型类型。
 *
 * 注册:内置 channel 由 `ensureRegistered()` 惰性注册(见 register.ts),
 * `getChannel/listChannels/registerAllChannels` 都会先确保已注册。
 */
import { registerBuiltinChannels } from "./register.ts"
import type { Kind, Item, Stream } from "@tauri-playground/xml"
import type { DanmakuItem, DanmakuStream, DanmakuOptions } from "./danmaku"

/** channel 产出的 item 种类。 */
export type { Kind } from "@tauri-playground/xml"
/** 懒解析返回的可播流。 */
export type { Stream } from "@tauri-playground/xml"
/** 弹幕统一契约(视频 VOD / 直播 Live 共用)。 */
export type { DanmakuItem, DanmakuStream, DanmakuOptions }

/** 渠道参数字段定义(描述实例化一个 source 需要什么)。 */
export type SourceInfo = Record<string, string>

/**
 * 可抓取的源实例(行为载体)。`fetch()` 直出 RSS 2.0 XML(标准子集 + `tpl:` 扩展)。
 * getSource 是纯函数:每次返回新实例,无缓存状态(复用/去重归 core 编排)。
 *
 * 能力按 interface 组合声明:`RssSource` 只保证 fetch;source 是否还可播放由
 * 它在 getSource 时 `implements` 的 `VideoPlayable`/`LivePlayable` 决定。
 */
export interface RssSource {
  /** 抓取并返回 RSS 2.0 XML 字符串。 */
  fetch(): Promise<string>
}

/** 视频懒解析能力(可选能力,有该能力的 source 才 implements)。 */
export interface VideoPlayable {
  /** 按 item id(如 bvid)懒解析可播流。URL 带 deadline 签名,播放时调用而非塞进 refresh。 */
  resolvePlay(itemId: string): Promise<Stream[]>
}

/** 直播懒解析能力(可选能力,有该能力的 source 才 implements)。 */
export interface LivePlayable {
  /** 按 roomId 懒解析可播流。playUrls 带 expiry 签名,播放时调用。 */
  resolveLivePlay(roomId: string): Promise<Stream[]>
}

/** 热搜词懒加载能力(可选能力,有该能力的 source 才 implements)。 */
export interface HotWordSource {
  /** 热搜词 → 该词下内容流(core 经 serializeFeed/deserializeFeed 消费,无需再进 XML 语义)。 */
  resolveHotWord(word: string): Promise<Item[]>
}

/** 弹幕能力(可选能力,有该能力的 source 才 implements)。**单一接口**,VOD 视频弹幕
 * 与 live 直播聊天由实现方区分推送,消费者只管订阅、不关心全量还是增量:
 *   - VOD(视频):订阅后推一次全量,items 带 timeMs,按播放时间轴过滤;
 *   - live(直播聊天):持续推增量,items 无 timeMs,实时显示。
 */
export interface DanmakuPlayable {
  getDanmaku(id: string): DanmakuStream
}

/**
 * 扫码登录能力(可选能力,channel 级——平台账号登录,无需实例化 source)。
 * 与 source 能力(VideoPlayable 等)并列,但挂在 channel 上:登录是平台级操作,
 * 不依赖 info 实例化,且同平台多 channel(xhs:user/explore)共享同一账号。
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
 * 类型由 channel 在 getSource 时 implements 声明静态保证,这里只是把编译期
 * 已知的信息在运行时恢复出来(standard interface-guard idiom)。
 */
export function isRssVideoSource(s: RssSource): s is RssSource & VideoPlayable {
  return "resolvePlay" in s
}

export function isRssLiveSource(s: RssSource): s is RssSource & LivePlayable {
  return "resolveLivePlay" in s
}

export function isHotWordSource(s: RssSource): s is RssSource & HotWordSource {
  return "resolveHotWord" in s
}

export function isDanmakuPlayable(s: RssSource): s is RssSource & DanmakuPlayable {
  return "getDanmaku" in s
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
