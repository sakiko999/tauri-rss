/**
 * bilibili UGC 视频共享装配 —— 多个 video channel 共用的序列化装配。
 *
 * `ugc` 把 API 返回的原始视频对象归一成 Video item(kind=video,stream 留空——
 * playurl 直链由下游懒解析)。播放解析在 resolve 的 platform/bili/video-play.ts。
 */
import type { Video } from "@amoeba/xml"

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
