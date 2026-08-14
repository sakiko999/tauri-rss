/**
 * bilibili UGC 视频共享装配 —— 多个 video channel 共用的序列化/懒解析。
 *
 * `ugc` 把 API 返回的原始视频对象归一成 Video item(kind=video,stream 留空——
 * playurl 直链由下游懒解析);`resolveBiliPlay` 是 4 个 video channel 的 `resolvePlay`
 * 实现(bvid/aid → cid → 全档位 durl mp4 直链)。
 */
import type { Stream, Video } from "@tauri-playground/xml"
import type { SourceInfo } from "../../index.ts"
import { biliClient } from "../../platform/bili"

export const API = "https://api.bilibili.com"
const BVID_TIME = 1_589_990_400

/** bilibili UGC 视频 → Video(kind=video)。stream 留空——playurl 直链由下游懒解析。 */
export function ugc(sourceId: string, t: number, v: {
  title: unknown
  pic?: unknown
  desc?: unknown
  pubdate?: unknown
  aid?: unknown
  bvid?: unknown
  owner?: { name?: string } | undefined
  forceBvid?: boolean
  duration?: unknown
}): Video {
  const pubdate = Number(v.pubdate ?? 0)
  const aid = Number(v.aid ?? 0)
  const bvid = v.bvid ? String(v.bvid) : undefined
  const useBvid = (pubdate >= BVID_TIME || v.forceBvid) && bvid
  const link = useBvid ? `https://www.bilibili.com/video/${bvid}` : `https://www.bilibili.com/video/av${aid}`
  const ownerName = v.owner?.name
  return {
    id: bvid ?? `av${aid}`,
    sourceId,
    kind: "video",
    title: String(v.title ?? "(untitled)"),
    url: link,
    summary: v.desc ? String(v.desc) : undefined,
    thumbnail: v.pic ? String(v.pic) : undefined,
    poster: v.pic ? String(v.pic) : undefined,
    author: ownerName ? { name: ownerName } : undefined,
    publishedAt: pubdate ? pubdate * 1000 : undefined,
    fetchedAt: t,
    duration: typeof v.duration === "number" ? v.duration : undefined,
    channel: ownerName ? { name: ownerName } : undefined,
    // playable stream lazily resolved downstream — bilibili playurl needs bvid+cid and URLs carry a deadline signature
  }
}

/**
 * 共享的 bili 视频懒解析:bvid/aid → cid → 全档位 durl mp4 直链。
 * 4 个 video channel 的 `resolvePlay` 方法都调它(避免重复代码)。
 * info 携带 core 层注入的登录 cookie → 解锁更高档位(登录 1080P+);无则零登录。
 */
export async function resolveBiliPlay(itemId: string, info?: SourceInfo): Promise<Stream[]> {
  const cookie = info?.cookie || undefined
  const cid = await biliClient.resolveCid(itemId, cookie)
  return biliClient.resolvePlayUrl(itemId, cid, cookie)
}
