/**
 * youtube:live —— YouTube 直播订阅 channel。
 *
 * 与视频订阅(`youtube` channel)按 **channelKey 区分**:声明时定 kind,零判定请求。
 * YouTube 无独立「直播间 ID」,直播/视频共享 videoId 命名空间(`watch?v=xxx`),
 * 判定直播靠 player API 的 `playabilityStatus.liveStreamability`。因此「订阅直播」
 * 用 `youtube:live` + videoId 表达意图,不实时请求判定。
 *
 * `videoId` 字段也接受 **channelId**(UC 开头)锚点 = 订阅「该频道的直播」:每轮刷新
 * 经 Live tab 定位当前在播那场(在播 → url 指向该场可直接播;未开播 → offline item,
 * 与直播渠道族「锚点未开播 = offline」语义一致)。统一搜索「搜用户 → 直播间」目标
 * 落这一形态(与抖音 live:douyin 的 roomIds 接受主页链接同构,2026-11-03)。
 *
 * 播放走懒解析:resolveLivePlay(roomId=videoId)→ resolveYoutubeStreams
 * (iOS client hlsManifestUrl,失败降级 web 页)。
 */

import { fetchYoutubeChannelLive, getYoutubeLiveMeta, now } from "@amoeba/resolve"
import type { Live } from "@amoeba/xml"

import { makeApiChannel } from "../factory.ts"

/** channelId(UC 开头)与 videoId 的分流判据。 */
const isChannelId = (v: string): boolean => /^UC[\w-]{20,}$/.test(v)

// 仅输出 Live item(与 rsshub 一致);流/弹幕走 crawler/resolver(按 item.url→watch?v=)。
export const YoutubeLiveChannel = makeApiChannel({
  key: "youtube:live",
  name: "YouTube 直播",
  kind: "live",
  sourceInfoTpl: [{ key: "videoId", label: "直播或频道 ID", required: true }],
  channelTitle: (info) => `YouTube 直播 ${info.videoId ?? ""}`,
  channelLink: (info) => {
    const v = String(info.videoId ?? "")
    return isChannelId(v) ? `https://www.youtube.com/channel/${v}` : `https://www.youtube.com/watch?v=${v}`
  },
  fetchPage: async (info) => {
    const raw = String(info.videoId ?? "").trim()
    if (!raw) throw new Error("youtube:live 需要 videoId")
    const t = now()
    // channelId 锚点:Live tab 定位在播那场(失败如实抛错;无 LIVE badge = 未开播 offline)。
    if (isChannelId(raw)) return [await channelLiveItem(raw, t)]
    // videoId 直订:取真实元信息(title/频道名/是否直播中/观看数);失败回退占位。
    const meta = await getYoutubeLiveMeta(raw).catch(() => null)
    const live: Live = {
      id: raw,
      sourceId: "youtube:live",
      kind: "live",
      title: meta?.title || `YouTube ${raw}`,
      url: `https://www.youtube.com/watch?v=${raw}`,
      // 稳定缩略图约定:i.ytimg.com/vi/<videoId>/hqdefault.jpg —— 零请求,直播未开播
      // 也有占位封面(与视频 channel 的 videoItem 一致)。
      thumbnail: `https://i.ytimg.com/vi/${raw}/hqdefault.jpg`,
      poster: `https://i.ytimg.com/vi/${raw}/hqdefault.jpg`,
      author: meta?.author ? { name: meta.author } : undefined,
      fetchedAt: t,
      // 真实在播态(取不到 meta 时退化为声明态 "live")。
      platform: "youtube",
      roomId: raw,
      liveStatus: meta ? (meta.isLive ? "live" : "offline") : "live",
      online: meta?.online,
    }
    return [live]
  },
})

/**
 * channelId 锚点的 Live item:id 稳定锚定频道(`ylc-<channelId>`,跨刷新同一条目,
 * 在播状态由 liveStatus 表达);在播时 url 指向那场(播放懒解析直接可播),未开播
 * 指向频道页。
 */
async function channelLiveItem(channelId: string, t: number): Promise<Live> {
  // Live tab 是本形态的主数据源:失败(网络/风控)如实抛错,不装作「未开播」;
  // 只有成功响应里没有 LIVE badge 才是 offline。meta 仍是元数据层,失败退声明态。
  const ch = await fetchYoutubeChannelLive(channelId)
  const meta = ch.videoId ? await getYoutubeLiveMeta(ch.videoId).catch(() => null) : null
  return {
    id: `ylc-${channelId}`,
    sourceId: "youtube:live",
    kind: "live",
    title: meta?.title || ch.channelName || "YouTube 频道直播",
    url: ch.videoId ? `https://www.youtube.com/watch?v=${ch.videoId}` : `https://www.youtube.com/channel/${channelId}`,
    thumbnail: ch.thumb,
    author: ch.channelName ? { name: ch.channelName } : undefined,
    fetchedAt: t,
    platform: "youtube",
    // 未开播时 roomId 退化为 channelId(锚点本身),播放导航走 url 不受影响。
    roomId: ch.videoId ?? channelId,
    // meta 取得到以 player 判定为准;取不到但 Live tab 有在播场 → 信任 badge("live")。
    liveStatus: meta ? (meta.isLive ? "live" : "offline") : ch?.videoId ? "live" : "offline",
    online: meta?.online,
  }
}
