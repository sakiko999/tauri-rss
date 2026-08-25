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

export type ResolveKind = "video" | "live"

/** 平台标识(resolver 分发用;与 platform/ 目录一一对应)。 */
export type ResolvePlatform = "bilibili" | "youtube" | "douyu" | "huya" | "douyin"

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
  { test: /bilibili\.com\/video\/(BV\w+)/, platform: "bilibili", kind: "video", extractId: (u) => u.match(/\/video\/(BV\w+)/)?.[1] ?? null },
  { test: /bilibili\.com\/video\/(av\d+)/i, platform: "bilibili", kind: "video", extractId: (u) => u.match(/\/(av\d+)/i)?.[1] ?? null },
  // B 站直播(live.bilibili.com/{roomId})
  { test: /live\.bilibili\.com\/(\d+)/, platform: "bilibili", kind: "live", extractId: (u) => u.match(/live\.bilibili\.com\/(\d+)/)?.[1] ?? null },
  // YouTube(watch?v=/youtu.be;直播同 videoId)
  {
    test: /youtube\.com\/watch\?v=([^&]+)/,
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
  { test: /youtu\.be\/([^?/]+)/, platform: "youtube", kind: "video", extractId: (u) => u.match(/youtu\.be\/([^?/]+)/)?.[1] ?? null },
  // 虎牙直播(huya.com/{roomId})
  { test: /huya\.com\/(\d+)/, platform: "huya", kind: "live", extractId: (u) => u.match(/huya\.com\/(\d+)/)?.[1] ?? null },
  // 斗鱼直播(douyu.com/{roomId})
  { test: /douyu\.com\/(\d+)/, platform: "douyu", kind: "live", extractId: (u) => u.match(/douyu\.com\/(\d+)/)?.[1] ?? null },
  // 抖音直播(live.douyin.com/{rid})
  {
    test: /live\.douyin\.com\/(\S+)/,
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