/**
 * resolver/danmaku —— 按 item.url 获取弹幕流。
 *
 * 能力抽离:与 play.ts 对称,对任何来源(crawler/rsshub)的条目按 url 路由到
 * 各平台弹幕函数。kind(vod 视频弹幕 / live 直播聊天)从路由推断。
 */
import type { DanmakuStream } from "../danmaku/types.ts"
import { resolveRoute } from "./router.ts"
import { biliClient } from "../platform/bili"
import { douyinClient } from "../platform/douyin"
import { douyuClient } from "../platform/douyu"
import { huyaClient } from "../platform/huya"
import { youtubeClient } from "../platform/youtube"

export interface DanmakuInfo {
  cookie?: string
  /** 视频 VOD 弹幕(带 timeMs 按时间轴)还是 live 直播聊天。缺省由路由 kind 推断。 */
  kind?: "vod" | "live"
}

/** 按平台 + id 获取弹幕流(不依赖 url,已确定平台)。 */
export function getDanmakuById(
  platform: "bilibili" | "youtube" | "douyu" | "huya" | "douyin",
  id: string,
  opts?: DanmakuInfo,
): DanmakuStream {
  switch (platform) {
    case "bilibili":
      return biliClient.getDanmaku(id, { kind: opts?.kind ?? "vod", cookie: opts?.cookie })
    case "youtube":
      // YouTube 弹幕是 live chat 轮询(videoId);VOD 无弹幕。
      return youtubeClient.getDanmaku(id)
    case "douyu":
      return douyuClient.getDanmaku(id)
    case "huya":
      return huyaClient.getDanmaku(id)
    case "douyin":
      return douyinClient.getDanmaku(id)
    default:
      throw new Error(`resolver: 平台 ${platform} 无弹幕能力`)
  }
}

/** 按 item.url 获取弹幕流:路由 → id + kind → 平台弹幕函数。 */
export function getDanmakuByUrl(url: string, info?: DanmakuInfo): DanmakuStream {
  const route = resolveRoute(url)
  if (!route) throw new Error(`resolver: 无法从 URL 路由弹幕: ${url}`)
  const kind = info?.kind ?? (route.kind === "video" ? "vod" : "live")
  return getDanmakuById(route.platform, route.id, { ...info, kind })
}