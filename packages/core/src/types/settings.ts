/**
 * App settings — user preferences, persisted via a `SettingsRepository`.
 */
import {
  DEFAULT_BILIBILI_COOKIE,
  DEFAULT_WEIBO_COOKIE,
  DEFAULT_XHS_COOKIE,
  DEFAULT_DOUYIN_COOKIE,
} from "../bilibili-cookie.ts"

export type ViewMode = "reader" | "masonry" | "shortvideo"
export type ThemeMode = "light" | "dark" | "system"
export type Density = "comfortable" | "compact"
/** 播放默认档位策略:锁最高档(防隧道带宽估算降档)/ 自动。 */
export type QualityMode = "highest" | "auto"
/**
 * 网络请求风控等级(见 docs/crawler-risk-control.md §2.4):
 *   0 = 无限制,governor 直通(仅调试);
 *   1 = 入门(L1,最宽松的受控档);
 *   2 = 标准(L2);
 *   3 = 严格(L3);
 *   9 = 浏览器被动(L9 / LX),禁止应用主动请求,只读被动采集缓冲 / 内容缓存。
 *
 * ⚠️ 全局默认只能是 0~3 —— L9 意味着"该平台完全不能主动抓取",不能一刀切
 * 套到所有渠道;它只出现在 `netLevels` 的平台覆盖里。
 */
export type NetLevel = 0 | 1 | 2 | 3 | 9
/** 全局默认档(不含 L9)。 */
export type GlobalNetLevel = 0 | 1 | 2 | 3

/**
 * 内置的**渠道级**默认等级(可被 `netLevels[channelKey]` 覆盖)。
 *
 * `xhs:user` 必须走浏览器导航读 SSR —— 应用构造的 HTTP 请求拿不到完整数据，
 * 页面内自定义 fetch 又属于 LX 定义里的类别②，所以它默认就是 L9。
 * 匿名导航拿不到笔记时回退内容缓存(这是 L9 的既定语义)。
 *
 * ⚠️ 只在**有浏览器能力**(`appHost.browser`)时生效；移动端没有 browser，
 * 由 `netLevelFor` 回落到平台/全局等级(否则该渠道会永远只剩缓存)。
 */
export const BUILTIN_CHANNEL_LEVELS: Readonly<Record<string, NetLevel>> = {
  "xhs:user": 9,
}

export interface AppSettings {
  /**
   * ⚠️ 目前**无消费者**:三模式 UI(reader/masonry/shortvideo)只实现了 reader。
   * 保留字段是为将来做瀑布流/短视频模式时不必再动 schema。
   */
  viewMode: ViewMode
  /**
   * ⚠️ 表现型偏好(主题/密度/字号/动效/行宽)**不在 core settings 里** —— 桌面端
   * 放在 localStorage 的 `ui-prefs`,因为首帧脚本必须**同步**读到主题,而这里走
   * 异步 SQLite 读不到。下同:只保留功能型设置。
   */
  theme: ThemeMode
  fontSize: number
  density: Density
  autoplayVideo: boolean
  /**
   * ⚠️ 目前**无消费者**:起播静音与否由 player 的 autoplay 策略决定(被 policy 拦
   * 时才降级静音,见 player/utils/attemptPlay.ts)。保留字段待「默认静音」需求。
   */
  startMuted: boolean
  dataSaver: boolean
  /** 自动刷新间隔(分钟)。同时是内容缓存 TTL:订阅级 refreshIntervalSec 优先,否则本值。 */
  refreshIntervalMin: number
  /** 网络请求风控**全局默认**等级。0 无限制 / 1 入门 / 2 标准 / 3 严格(不含 9)。 */
  netLevel: GlobalNetLevel
  /**
   * 平台级等级覆盖(平台名 → 等级)。未列出的平台继承 `netLevel`。
   * 键支持 `"*"`(未知 host / RSS 兜底)与 channelKey(如 `xhs:user`,仅 core 的
   * 抓取闸门识别;宿主 governor 只认平台名)。
   */
  netLevels: Record<string, NetLevel>
  /** 后台自动刷新。关闭后启动 / 新建订阅不自动抓取,只允许手动刷新。 */
  autoRefresh: boolean
  /** 打开文章即标已读。 */
  markReadOnOpen: boolean
  /**
   * ⚠️ 目前**无消费者,且不该有**:crawler 契约已保证返回数组内**最高清晰度排最前**,
   * player 取第一个即最高档;而 "auto" 会踩隧道带宽估算失真的坑(自动降档后不回升,
   * 见 docs)。保留字段仅为避免 schema 变动。
   */
  defaultQuality: QualityMode
  /** 弹幕总开关(播放器按此决定是否建弹幕流)。 */
  danmakuEnabled: boolean
  /** 一集播完自动播队列里的下一条。关闭则播完停住。 */
  autoPlayNext: boolean
  /** 防盗链图片经宿主隧道转发(命中 mediaReferrerFor 的图床)。 */
  imageProxy: boolean
  /**
   * bilibili 登录 cookie(浏览器复制的完整串,含 SESSDATA)。
   * 作 core 层默认:所有 bili 订阅(live/video)未显式配 cookie 时自动带上,
   * 解锁登录档位(非大会员 1080p/原画)。留空 = 零登录。
   */
  bilibiliCookie: string
  /** 微博登录 cookie(浏览器复制完整串,含 SUB)。作 core 层默认:weibo:* 订阅自动带上。 */
  weiboCookie: string
  /** 小红书登录 cookie(浏览器复制完整串)。作 core 层默认:xhs:* 订阅自动带上。 */
  xhsCookie: string
  /** 抖音登录 cookie(扫码或浏览器复制)。作 core 层默认:live:douyin* 订阅自动带上,解锁原画档位。 */
  douyinCookie: string
  /**
   * RSSHub 实例地址(rsshub:* 源默认 baseUrl;订阅级 info.baseUrl 覆盖)。
   * 外挂模式:RSSHub 是可选外部 HTTP 服务(自部署或公网 rsshub.app),不内嵌。
   */
  rsshubBaseUrl: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  viewMode: "reader",
  theme: "system",
  fontSize: 16,
  density: "comfortable",
  autoplayVideo: true,
  startMuted: true,
  dataSaver: false,
  refreshIntervalMin: 30,
  netLevel: 1,
  netLevels: {},
  autoRefresh: true,
  markReadOnOpen: true,
  defaultQuality: "highest",
  danmakuEnabled: true,
  autoPlayNext: true,
  imageProxy: true,
  bilibiliCookie: DEFAULT_BILIBILI_COOKIE,
  weiboCookie: DEFAULT_WEIBO_COOKIE,
  xhsCookie: DEFAULT_XHS_COOKIE,
  douyinCookie: DEFAULT_DOUYIN_COOKIE,
  rsshubBaseUrl: "https://rsshub.app",
}
