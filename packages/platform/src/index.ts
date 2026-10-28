/**
 * 平台表 —— 平台名的**单一权威**（R9）。
 *
 * 平台名是字符串协议，跨四个消费方流转：
 *   - `host/src/net/governor.ts`：按 URL 域名分桶（并发/RPM/冷却）；
 *   - `core/src/data-layer.ts`：channelKey → 平台 → settings cookie 字段；
 *   - `apps/desktop`：账号页展示名、清 cookie 的站点表；
 *   - `apps/cli`：`rss login <platform>` 的平台 → 可登录渠道。
 *
 * 此前每处各手抄一份，新增平台必漏配（漏一处是静默错误）。依赖矩阵不允许
 * host 依赖 core、core 也不依赖 host 的生产代码，所以表放在这个零依赖叶子里
 * （与 `@amoeba/log` 同构），两边都只依赖它。
 *
 * 新增平台：只改 `PLATFORMS`。
 */

export interface PlatformDef {
  /** 平台名：governor 分类键 / settings.netLevels 键 / cookie 前缀共用同一个字符串。 */
  id: string
  /** 展示名（账号页、诊断）。 */
  label: string
  /** 域名后缀（不带前导点）；host governor 据此分类。 */
  hosts: string[]
  /** channelKey 前缀（不含末尾冒号；"live:douyin" 这类多段前缀原样写）。 */
  prefixes: string[]
  /** settings 里的 cookie 字段名；没有登录态的平台的省略。 */
  cookieField?: string
  /**
   * 抓取浏览器**登录路径**的站点（诊断「清除凭证」需要一并登出）。
   * 纯 HTTP 登录的平台（bili）不列 —— 清 settings 即可，不该为此拉起浏览器。
   */
  browserCookieHosts?: string[]
}

export const PLATFORMS: readonly PlatformDef[] = [
  {
    id: "bili",
    label: "B站",
    hosts: ["bilibili.com"],
    prefixes: ["bili"],
    cookieField: "bilibiliCookie",
  },
  {
    id: "weibo",
    label: "微博",
    hosts: ["weibo.com", "weibo.cn"],
    prefixes: ["weibo"],
    cookieField: "weiboCookie",
    browserCookieHosts: ["weibo.cn", "weibo.com"],
  },
  {
    id: "xhs",
    label: "小红书",
    hosts: ["xiaohongshu.com"],
    prefixes: ["xhs"],
    cookieField: "xhsCookie",
    browserCookieHosts: ["xiaohongshu.com"],
  },
  {
    id: "douyin",
    label: "抖音",
    hosts: ["douyin.com"],
    // ⚠️ 抖音直播渠道前缀是 `live:douyin*`，不是 `douyin:*`；两个都收。
    prefixes: ["live:douyin", "douyin"],
    cookieField: "douyinCookie",
    browserCookieHosts: ["douyin.com"],
  },
  {
    id: "douyu",
    label: "斗鱼",
    hosts: ["douyu.com"],
    prefixes: ["live:douyu", "douyu"],
  },
  {
    id: "huya",
    label: "虎牙",
    hosts: ["huya.com"],
    prefixes: ["live:huya", "huya"],
  },
  {
    id: "youtube",
    label: "YouTube",
    hosts: ["youtube.com", "youtubei.googleapis.com"],
    prefixes: ["youtube"],
  },
  {
    id: "apple",
    label: "Apple 播客",
    hosts: ["itunes.apple.com"],
    prefixes: ["apple"],
  },
  {
    id: "twitch",
    label: "Twitch",
    hosts: ["twitch.tv", "ttvnw.net", "jtvnw.net"],
    prefixes: ["twitch"],
  },
  {
    id: "rsshub",
    label: "RSSHub",
    hosts: ["rsshub.app"],
    prefixes: ["rsshub"],
  },
]

/** 有登录态的平台（账号页 / `rss login` 的可用列表）。 */
export const LOGIN_PLATFORMS: readonly string[] = PLATFORMS.filter((p) => p.cookieField).map((p) => p.id)

export function platformDef(id: string): PlatformDef | undefined {
  return PLATFORMS.find((p) => p.id === id)
}

/**
 * 长前缀优先，避免 `douyin` 抢在 `live:douyin` 前面。
 * ⚠️ 不能给前缀强加尾冒号再 `startsWith`：`live:douyin` 这类前缀**本身就是完整 key**
 * （抖音直播渠道），`live:douyin:` 永远匹配不到它 —— 那样 cookie 注入、netLevels 折叠、
 * `rss login douyin`、账号页扫码入口会一起静默失灵。
 */
const PREFIX_ENTRIES = PLATFORMS.flatMap((p) => p.prefixes.map((prefix) => ({ prefix, platform: p.id }))).sort(
  (a, b) => b.prefix.length - a.prefix.length,
)

/** channelKey → 平台名；未登记的前缀返回 undefined（rss: 直链等）。 */
export function platformOfChannelKey(channelKey: string): string | undefined {
  return PREFIX_ENTRIES.find((e) => channelKey === e.prefix || channelKey.startsWith(`${e.prefix}:`))?.platform
}

const HOST_ENTRIES = PLATFORMS.flatMap((p) => p.hosts.map((host) => ({ host, platform: p.id })))

/**
 * URL 域名 → 平台名。未登记的域名去掉 `www.` 后原样作平台（每站一个桶），
 * 与 governor 的历史行为一致。
 */
export function platformOfHost(host: string): string {
  if (!host) return "unknown"
  for (const e of HOST_ENTRIES) {
    if (host === e.host || host.endsWith(`.${e.host}`)) return e.platform
  }
  return host.startsWith("www.") ? host.slice(4) : host
}

/** 平台名 → settings cookie 字段名。 */
export function cookieFieldOf(platform: string): string | undefined {
  return platformDef(platform)?.cookieField
}

/** channelKey → settings cookie 字段名。 */
export function cookieFieldForChannelKey(channelKey: string): string | undefined {
  const platform = platformOfChannelKey(channelKey)
  return platform ? cookieFieldOf(platform) : undefined
}

/** 平台名 → 抓取浏览器的登录站点（诊断清 cookie 用）。 */
export function browserCookieHostsOf(platform: string): string[] | undefined {
  return platformDef(platform)?.browserCookieHosts
}
