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

import type { Item, Kind } from "@amoeba/xml"

import { registerBuiltinChannels } from "./register.ts"

/** channel 产出的 item 种类。 */
export type { Kind } from "@amoeba/xml"

/** 宿主 HTTP 便捷层(httpText/httpJson/httpGet)——core source 层(rsshub 直传)复用。 */
export { httpGet, httpText, httpJson } from "@amoeba/resolve"

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
  /**
   * 被动采集（LX）：从 `passiveBuffer` / 页面 SSR 取最近一份页面数据并解析
   * （见风控 §3.8/§3.10）。无可用数据返回 null；**缺失 = 该渠道不支持被动模式**。
   * 渠道声明 `passive` 时 core 只调用它，读不到就走内容缓存，绝不回退 `fetch()`
   * （否则就变成主动请求了）。
   */
  fetchPassive?(): Promise<string | null>
}

/** LX 被动采集的内存缓冲（原始 body 只进内存，不落盘）。 */
export { PassiveBuffer, passiveBuffer, canonicalUrl } from "./passive/buffer.ts"
export type { PassiveEntry, PassiveBufferOptions, PassivePushInput } from "./passive/buffer.ts"

/** 热搜词懒加载能力(可选能力,有该能力的 source 才 implements)。 */
export interface HotWordSource {
  /** 热搜词 → 该词下内容流(core 经 serializeFeed/deserializeFeed 消费,无需再进 XML 语义)。 */
  resolveHotWord(word: string): Promise<Item[]>
}

/** 单条详情能力(可选能力):列表 item 缺全文/多图时(如 xhs 列表只有单图摘要),按需抓详情。 */
export interface ItemDetailSource {
  /**
   * 单条 → 完整详情 Item(xhs 登录态 GET /explore/<id>?xsec_token= 补全文/多图/tag/video)。
   *
   * `passive = true` 来自 core 对渠道 `passive` 属性的判定:只允许**页面自然行为**
   * (导航 + 读页面 SSR),不得构造自定义 fetch / API。渠道不按 passive 降级时应返回
   * null(而不是偷偷发请求)。
   */
  resolveDetail(item: Item, opts?: { passive?: boolean }): Promise<Item | null>
}

/**
 * 扫码登录能力(可选能力,channel 级——平台账号登录,无需实例化 source)。
 * 登录是平台级操作,不依赖 info 实例化,且同平台多 channel(xhs:user/explore)共享同一账号。
 */
export interface Loginable {
  /**
   * 扫码登录。emitQr 回调把二维码推给 UI(可空 = 还没出码)。
   *
   * ⚠️ **推的是字符串,语义按平台不同**:
   *   - `data:image/...` 的 data URL → 浏览器路径(xhs)已经编码好了,UI 直接当
   *     `<img src>` 用;
   *   - 其余视作**二维码内容**(bili 走纯 HTTP 协议,上游只给一段 URL)→ UI 侧
   *     用自己的 QR 编码器画出来。
   * 这样纯 HTTP 的登录不必把 QR 编码器拖进 crawler(编码是展示关切)。
   *
   * `opts.signal`:UI 关闭二维码弹窗时 abort。登录在实现里持全局浏览器锁直到成功或
   * 超时(最长 5 分钟),没有取消通道的话,关窗后所有 xhs/weibo 浏览器操作都被排队卡住。
   *
   * 成功后 cookie 已落浏览器 profile 或由本方法返回(HTTP 路径),返回串供 core
   * 落 settings。无 appHost.browser 的路径(xhs)会抛错,bili 纯 HTTP 不需要。
   */
  scanLogin(
    emitQr: (qr: string | null) => void,
    opts?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<LoginResult>
}

/** 扫码登录结果。cookie 为 document.cookie 全量(含 web_session/a1/webId 等)。 */
export interface LoginResult {
  cookie: string
  user_id?: string
  /** 原本就已登录(未触发扫码即检测到),UI 据此提示而非展示新二维码。 */
  alreadyLoggedIn?: boolean
}

/**
 * 浏览器 profile 的登录 cookie 快照(应用启动时 core 用它对齐 settings)。
 * `null` = 浏览器里没有登录标记,**不等于确定登出**(见 core syncBrowserCookies)。
 */
export interface LoginCookieSnapshot {
  /** `k=v; k2=v2`(含 HttpOnly;按 key 排序,便于稳定比较)。 */
  cookie: string
  user_id?: string
}

/** 翻页能力(可选能力):列表源(直播 hot 等)可翻页加载更多。 */
export interface Pageable {
  /**
   * 翻页:取下一页并返回新 XML + 下一页游标。
   * cursor 传上次返回的 cursor;首次翻页不传(取第 2 页)。返回的 cursor 省略 = 没有更多。
   *
   * `ctx.existing` = 该订阅当前在 store 里的条目数。游标是「页面 state 列表下标」的
   * 渠道(小红书)首次翻页必须用它,而不是页面当前长度:共享 Edge 页面可能已被
   * 上一次滚动养到几百条,而 store 只有首屏几十条 —— 用页面长度会跳过中间几百条。
   *
   * `hasMore` = 上游明确说「还有下一页」(可选)。**过滤过条目的渠道必须给**:
   * core 默认「游标前进但 0 条新增 ⇒ 到底」,对「整页都是失效条目」会误判成没有更多。
   */
  fetchMore(cursor?: string, ctx?: { existing: number }): Promise<{ xml: string; cursor?: string; hasMore?: boolean }>
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
  /**
   * 该渠道的**正常路径是浏览器被动采集**（导航 + 读页面 SSR / CDP Network 缓冲）。
   *
   * 这是**渠道自身属性**，不是防御等级：有 `appHost.browser` 时 core 只调
   * `fetchPassive()`（拿不到就回退内容缓存，绝不回退 `fetch()`）；没有浏览器
   * （移动端 / CLI）时回落普通主动抓取。防御等级（0~3）表达的是「配额/冷却收多紧」，
   * 与被谁发起请求无关 —— 需要被动的渠道几乎不会主动降级，所以不再让用户选 L9。
   *
   * ⚠️ 声明 true 的渠道必须在 `getSource()` 返回的 source 上提供 `fetchPassive()`；
   * 声明与实现不一致时被动路径会退化为缓存。
   */
  readonly passive?: boolean
  /**
   * 启动快照能力(可选):从浏览器 profile **只读**当前登录 cookie,供 core 在
   * 应用启动时把 settings 里的凭证快照对齐到浏览器。不得导航/发请求;未登录返回
   * `null`。只有「桌面侧消费 settings cookie」的平台需要实现(xhs/weibo/douyin;
   * bili 纯 HTTP 签名,不需要)。
   */
  readLoginCookie?(browser: BrowserBackend): Promise<LoginCookieSnapshot | null>
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
