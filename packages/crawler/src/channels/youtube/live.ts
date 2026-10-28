/**
 * youtube:live —— YouTube 直播订阅 channel。
 *
 * 与视频订阅(`youtube` channel)按 **channelKey 区分**:声明时定 kind,零判定请求。
 * YouTube 无独立「直播间 ID」,直播/视频共享 videoId 命名空间(`watch?v=xxx`),
 * 判定直播靠 player API 的 `playabilityStatus.liveStreamability`。因此「订阅直播」
 * 用 `youtube:live` + videoId 表达意图,不实时请求判定。
 *
 * fetch 产单个 Live item(liveStatus 信任声明为 "live";精确在线状态需 player API,
 * 留未来增强)。播放走懒解析:resolveLivePlay(roomId=videoId)→ resolveYoutubeStreams
 * (iOS client hlsManifestUrl,失败降级 web 页)。
 */

import { getYoutubeLiveMeta, now } from "@amoeba/resolve"
import type { Live } from "@amoeba/xml"

import { makeApiChannel } from "../factory.ts"

// 仅输出 Live item(与 rsshub 一致);流/弹幕走 crawler/resolver(按 item.url→watch?v=)。
export const YoutubeLiveChannel = makeApiChannel({
  key: "youtube:live",
  name: "YouTube 直播",
  kind: "live",
  sourceInfoTpl: [{ key: "videoId", label: "直播 ID", required: true }],
  channelTitle: (info) => `YouTube 直播 ${info.videoId ?? ""}`,
  channelLink: (info) => `https://www.youtube.com/watch?v=${info.videoId ?? ""}`,
  fetchPage: async (info) => {
    const videoId = info.videoId ?? ""
    if (!videoId) throw new Error("youtube:live 需要 videoId")
    const t = now()
    // 取真实元信息(title/频道名/是否直播中/观看数);失败回退占位(不阻塞订阅)。
    const meta = await getYoutubeLiveMeta(videoId).catch(() => null)
    const live: Live = {
      id: videoId,
      sourceId: "youtube:live",
      kind: "live",
      title: meta?.title || `YouTube ${videoId}`,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      // 稳定缩略图约定:i.ytimg.com/vi/<videoId>/hqdefault.jpg —— 零请求,直播未开播
      // 也有占位封面(与视频 channel 的 videoItem 一致)。
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      poster: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      author: meta?.author ? { name: meta.author } : undefined,
      fetchedAt: t,
      // 真实在播态(取不到 meta 时退化为声明态 "live")。
      platform: "youtube",
      roomId: videoId,
      liveStatus: meta ? (meta.isLive ? "live" : "offline") : "live",
      online: meta?.online,
    }
    return [live]
  },
})
