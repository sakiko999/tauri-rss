/**
 * resolver/play —— 按 item.url 解析可播流。
 *
 * 能力抽离:crawler/rsshub 的输出都只是基础信息(item.url 指向平台详情页)。
 * 这里把「URL → 可播流」解析统一收敛:crawler 自家来源与 rsshub 来源的条目
 * 都按 url 路由到各自平台解析函数,一起生效。
 *
 * info 透传 cookie(登录态档位):core 层经 sourceInfoFor/routedSourceInfo 注入。
 */
import type { Stream } from "@tauri-playground/xml"
import type { SourceInfo } from "../index.ts"
import { resolveRoute, type ResolvePlatform } from "./router.ts"
import { resolveBiliLivePlay, resolveBiliVideoPlay } from "../platform/bili"
import { douyinResolveStreams } from "../platform/douyin"
import { douyuResolveStreams } from "../platform/douyu"
import { resolveHuyaLivePlay } from "../platform/huya"
import { resolveYoutubeStreams } from "../platform/youtube"

/** resolver 解析参数:复用 SourceInfo(含 cookie),必要时扩展。 */
export type ResolveInfo = SourceInfo & { cookie?: string }

export interface ResolveResult {
  /** 路由命中的平台 id(视频 bvid/直播 roomId 等;调试/日志用)。 */
  id: string
  streams: Stream[]
}

/**
 * 按 item.url 解析视频可播流(kind=video 路由)。
 * url 必须是视频详情页;直播按 resolveLivePlayByUrl。
 */
export async function resolvePlayByUrl(url: string, info?: ResolveInfo): Promise<ResolveResult> {
  const route = resolveRoute(url)
  if (!route || route.kind !== "video") {
    throw new Error(`resolver: 无法从 URL 解析视频流(仅支持 bilibili 视频/YouTube): ${url}`)
  }
  // kind==="video" ⇒ 平台仅在 bilibili|youtube(路由表由 kind 判别保证)。
  const streams = await resolveVideoStreams(route.platform as VideoPlatform, route.id, info)
  return { id: route.id, streams }
}

/** 按 item.url 解析直播可播流(kind=live 路由)。 */
export async function resolveLivePlayByUrl(url: string, info?: ResolveInfo): Promise<ResolveResult> {
  const route = resolveRoute(url)
  if (!route || route.kind !== "live") {
    throw new Error(`resolver: 无法从 URL 解析直播流(需直播路由): ${url}`)
  }
  // kind==="live" ⇒ 平台仅在 bilibili|douyu|huya|douyin(路由表由 kind 判别保证)。
  const streams = await resolveLiveStreams(route.platform as LivePlatform, route.id, info)
  return { id: route.id, streams }
}

/** 视频平台(video 路由可命中的平台)。 */
type VideoPlatform = Extract<ResolvePlatform, "bilibili" | "youtube">

/** 按视频平台 + id 解析可播流。 */
export async function resolveVideoStreams(
  platform: VideoPlatform,
  id: string,
  info?: ResolveInfo,
): Promise<Stream[]> {
  if (platform === "bilibili") return resolveBiliVideoPlay(id, info)
  return resolveYoutubeStreams(id)
}

/** 直播平台(live 路由可命中的平台)。 */
type LivePlatform = Extract<ResolvePlatform, "bilibili" | "douyu" | "huya" | "douyin">

/** 按直播平台 + roomId 解析可播流。 */
export async function resolveLiveStreams(
  platform: LivePlatform,
  id: string,
  info?: ResolveInfo,
): Promise<Stream[]> {
  switch (platform) {
    case "bilibili":
      return resolveBiliLivePlay(id, info)
    case "douyu":
      return douyuResolveStreams(id)
    case "huya":
      return resolveHuyaLivePlay(id)
    case "douyin":
      return douyinResolveStreams(id)
    default:
      throw new Error(`resolver: 平台 ${platform} 不支持直播解析`)
  }
}

/** bili 弹幕能力(按 id + kind vod/live)——resolver 弹幕入口内部复用。 */
