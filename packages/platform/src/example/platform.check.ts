/**
 * 平台表自检 —— `bun packages/platform/src/example/platform.check.ts`
 *
 * 守住的是「同一平台在四处得到同一个字符串」：channelKey 前缀、URL 域名、
 * cookie 字段、展示元数据。新增平台漏配任何一处都会在这里红。
 */

import {
  browserCookieHostsOf,
  cookieFieldForChannelKey,
  cookieFieldOf,
  LOGIN_PLATFORMS,
  platformDef,
  platformOfChannelKey,
  platformOfHost,
  PLATFORMS,
} from "../index.ts"

let failed = 0
const eq = (actual: unknown, expected: unknown, label: string): void => {
  if (actual === expected) console.log(`  ✓ ${label}`)
  else {
    failed += 1
    console.error(`  ✗ ${label}: 期望 ${String(expected)}，得到 ${String(actual)}`)
  }
}

// channelKey → 平台
eq(platformOfChannelKey("bili:popular"), "bili", "bili 渠道")
eq(platformOfChannelKey("xhs:user"), "xhs", "xhs 渠道")
eq(platformOfChannelKey("live:douyin:live"), "douyin", "抖音直播渠道（多段前缀）")
eq(platformOfChannelKey("douyin:trend"), "douyin", "抖音非 live 渠道")
// 回归（2026-10-26）：前缀加尾冒号曾让「本身即完整 key」的直播渠道全部匹配失败 ——
// 后果是 cookie 不注入 / netLevels 不折叠 / rss login douyin 报无可登录渠道。
eq(platformOfChannelKey("live:douyin"), "douyin", "抖音直播（key 即前缀，无尾段）")
eq(platformOfChannelKey("live:douyu"), "douyu", "斗鱼直播（key 即前缀）")
eq(platformOfChannelKey("live:huya"), "huya", "虎牙直播（key 即前缀）")
eq(cookieFieldForChannelKey("live:douyin"), "douyinCookie", "抖音直播单渠道能取到 cookie 字段")
eq(platformOfChannelKey("douyinlike:trend"), undefined, "前缀必须按段边界匹配")
eq(platformOfChannelKey("live:douyu:hot"), "douyu", "斗鱼渠道")
eq(platformOfChannelKey("youtube:live"), "youtube", "YouTube 渠道")
eq(platformOfChannelKey("rsshub:github"), "rsshub", "RSSHub 渠道")
eq(platformOfChannelKey("rss:podcast"), undefined, "rss 直链不归平台")
eq(platformOfChannelKey("weibo:user"), "weibo", "微博渠道")

// cookie 字段
eq(cookieFieldForChannelKey("bili:favlist"), "bilibiliCookie", "bili cookie 字段")
eq(cookieFieldForChannelKey("live:douyin:live"), "douyinCookie", "抖音 cookie 字段（多段前缀）")
eq(cookieFieldForChannelKey("xhs:explore"), "xhsCookie", "xhs cookie 字段")
eq(cookieFieldForChannelKey("live:huya:live"), undefined, "虎牙没有登录态字段")
eq(cookieFieldOf("weibo"), "weiboCookie", "平台 → cookie 字段")

// URL 域名 → 平台
eq(platformOfHost("api.bilibili.com"), "bili", "bilibili 域名")
eq(platformOfHost("www.xiaohongshu.com"), "xhs", "xiaohongshu 域名")
eq(platformOfHost("m.weibo.cn"), "weibo", "weibo.cn 域名")
eq(platformOfHost("www.douyin.com"), "douyin", "douyin 域名")
eq(platformOfHost("youtubei.googleapis.com"), "youtube", "youtubei 精确域名")
eq(platformOfHost("rsshub.app"), "rsshub", "rsshub 公网实例")
eq(platformOfHost("www.example.com"), "example.com", "未知域名去 www 后原样作桶")
eq(platformOfHost(""), "unknown", "空域名")

// 浏览器登录站点（诊断清 cookie）
eq(JSON.stringify(browserCookieHostsOf("xhs")), JSON.stringify(["xiaohongshu.com"]), "xhs 浏览器站点")
eq(browserCookieHostsOf("bili"), undefined, "bili 纯 HTTP 不列浏览器站点")

// 可登录平台与 cookie 字段同源
eq(LOGIN_PLATFORMS.includes("xhs") && LOGIN_PLATFORMS.includes("douyin"), true, "可登录平台含 xhs/douyin")
eq(platformDef("xhs")?.label, "小红书", "展示名")

// 表自身：id 唯一、前缀唯一
eq(new Set(PLATFORMS.map((p) => p.id)).size, PLATFORMS.length, "平台 id 唯一")
const prefixes = PLATFORMS.flatMap((p) => p.prefixes)
eq(new Set(prefixes).size, prefixes.length, "channelKey 前缀唯一")

console.log(failed ? `\n${failed} 项失败` : "\n全部通过")
process.exit(failed ? 1 : 0)
