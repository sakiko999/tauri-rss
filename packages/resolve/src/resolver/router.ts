/**
 * resolver/router —— URL → 平台路由表。
 *
 * 能力抽离核心:crawler/rsshub 的输出都只是基础信息(item.url 指向平台详情页),
 * 播放/弹幕解析按 item.url 统一路由到平台解析函数。本路由表维护
 * 「URL 形态 → platform + id + kind」的映射,供 play.ts/danmaku.ts 解析调用。
 *
 * 从 core/processing/play-resolver.ts 迁入(那里只能回退 crawler channel;此处
 * 直接定位平台,由 crawler 的 resolver 调 platform/ 独立解析函数)。
 */

import { isTwitchChannelHost, isTwitchLogin } from "../utils/twitch.ts"

export type ResolveKind = "video" | "live"

/** 平台标识(resolver 分发用;与 platform/ 目录一一对应)。 */
export type ResolvePlatform = "bilibili" | "youtube" | "douyu" | "huya" | "douyin" | "twitch"

export interface ResolveRouteSpec {
  /** 匹配 item.url。 */
  test: RegExp
  platform: ResolvePlatform
  kind: ResolveKind
  /** 从 url 提 id(video bvid/av 号、live roomId 等);失败返回 null 则跳过此路由。 */
  extractId(url: string): string | null
}

/** 路由表:顺序优先级(更具体的 domain 排前面)。按需扩充。 */
const ROUTES: ResolveRouteSpec[] = [
  // B 站视频(BV 号 / av 号)
  { test: /(?:^|[./])bilibili\.com\/video\/(BV\w+)/, platform: "bilibili", kind: "video", extractId: (u) => u.match(/\/video\/(BV\w+)/)?.[1] ?? null },
  { test: /(?:^|[./])bilibili\.com\/video\/(av\d+)/i, platform: "bilibili", kind: "video", extractId: (u) => u.match(/\/(av\d+)/i)?.[1] ?? null },
  // B 站直播(live.bilibili.com/{roomId})
  { test: /(?:^|[./])live\.bilibili\.com\/(\d+)/, platform: "bilibili", kind: "live", extractId: (u) => u.match(/live\.bilibili\.com\/(\d+)/)?.[1] ?? null },
  // YouTube(watch?v=/youtu.be;直播同 videoId)
  // ⚠️ host 前加 `(?:^|[./])` 边界:否则 `notyoutube.com/watch?v=` 这类含子串的
  // 伪造域名也会命中(未锚定)。
  {
    test: /(?:^|[./])youtube\.com\/watch\?v=([^&]+)/,
    platform: "youtube",
    kind: "video",
    extractId: (u) => {
      try {
        return new URL(u).searchParams.get("v")
      } catch {
        return null
      }
    },
  },
  { test: /(?:^|[./])youtu\.be\/([^?/]+)/, platform: "youtube", kind: "video", extractId: (u) => u.match(/youtu\.be\/([^?/]+)/)?.[1] ?? null },
  // 虎牙直播(huya.com/{roomId})
  { test: /(?:^|[./])huya\.com\/(\d+)/, platform: "huya", kind: "live", extractId: (u) => u.match(/huya\.com\/(\d+)/)?.[1] ?? null },
  // 斗鱼直播(douyu.com/{roomId})
  { test: /(?:^|[./])douyu\.com\/(\d+)/, platform: "douyu", kind: "live", extractId: (u) => u.match(/douyu\.com\/(\d+)/)?.[1] ?? null },
  // 抖音直播(live.douyin.com/{rid})
  {
    test: /(?:^|[./])live\.douyin\.com\/(\S+)/,
    platform: "douyin",
    kind: "live",
    extractId: (u) => {
      try {
        const last = new URL(u).pathname.replace(/\/+$/, "").split("/").pop()
        return last && last !== "-" ? last : null
      } catch {
        return null
      }
    },
  },
  // Twitch 直播(twitch.tv/<login>,单段路径)。一期只路由频道首页:
  // `/videos/...`、`/<login>/clip/...` 留给二期(届时路由必须排在频道名之前),
  // 否则 clip/VOD 页会被误当频道名。
  {
    test: /(?:^|[./])twitch\.tv\/\S*/i,
    platform: "twitch",
    kind: "live",
    extractId: (u) => {
      try {
        const url = new URL(u)
        // ⚠️ 只认频道域:clip 链接是 `clips.twitch.tv/<slug>`(单段路径),
        // 不卡 host 就会把 clip slug 当频道名(见 utils/twitch.ts 的 CHANNEL_HOSTS)。
        if (!isTwitchChannelHost(url.hostname)) return null
        const segments = url.pathname.split("/").filter(Boolean)
        if (segments.length !== 1) return null
        // 与 normalizeTwitchLogin 同一套 URL 解析:百分号编码的 login 也要能路由。
        let login: string
        try {
          login = decodeURIComponent(segments[0]!).toLowerCase()
        } catch {
          return null
        }
        return isTwitchLogin(login) ? login : null
      } catch {
        return null
      }
    },
  },
]

/** 解析结果:平台 + id + 播放种类。 */
export interface ResolveRoute {
  platform: ResolvePlatform
  id: string
  kind: ResolveKind
}

/**
 * 按 url 路由:返回首个匹配的 { platform, id, kind },未命中返回 null。
 * 调用方据此调平台解析函数(resolvePlayByUrl / resolveLivePlayByUrl / getDanmakuByUrl)。
 */
export function resolveRoute(url: string | null | undefined): ResolveRoute | null {
  if (!url) return null
  for (const r of ROUTES) {
    if (!r.test.test(url)) continue
    const id = r.extractId(url)
    if (id) return { platform: r.platform, id, kind: r.kind }
  }
  return null
}