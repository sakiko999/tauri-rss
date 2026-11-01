/**
 * youtube:live-hot —— YouTube 直播页 `Live Now` 栏目订阅。
 *
 * 解析在 resolve `fetchYoutubeLiveShelves`(5 分钟缓存),输 `kind:"live"`,
 * 播放走既有 by-url 解析(`watch?v=<videoId>` → resolveYoutubeStreams)。
 * ⚠️ 按观看数降序(契约:列表顺序由渠道负责,默认选流/展示不依赖上游顺序)。
 */

import type { YoutubeLiveHit } from "@amoeba/resolve"
import { fetchYoutubeLiveShelves, now } from "@amoeba/resolve"
import type { Item, Live } from "@amoeba/xml"

import { makeApiChannel } from "../factory.ts"

/** 直播页条目 → Live item(`youtube:live-search` 也用它)。 */
export function youtubeLiveHitToLive(sourceId: string, hit: YoutubeLiveHit, t: number): Live {
  // 稳定缩略图约定:i.ytimg.com/vi/<videoId>/hqdefault.jpg —— 零请求,直播未开播
  // 也有占位封面(与 youtube:live 一致)。
  const thumb = hit.thumb ?? `https://i.ytimg.com/vi/${hit.videoId}/hqdefault.jpg`
  return {
    id: hit.videoId,
    sourceId,
    kind: "live",
    title: hit.title,
    url: `https://www.youtube.com/watch?v=${hit.videoId}`,
    thumbnail: thumb,
    poster: thumb,
    author: hit.channelTitle ? { name: hit.channelTitle } : undefined,
    fetchedAt: t,
    platform: "youtube",
    roomId: hit.videoId,
    liveStatus: "live",
    online: hit.viewers,
  }
}

/** 观看数降序(缺观看数的排最后,保持稳定)。 */
function byViewers(hits: YoutubeLiveHit[]): YoutubeLiveHit[] {
  return [...hits].sort((a, b) => (b.viewers ?? 0) - (a.viewers ?? 0))
}

/** `Live Now` 栏目订阅。无参数。 */
export const YoutubeLiveHotChannel = makeApiChannel({
  key: "youtube:live-hot",
  name: "YouTube 直播热门",
  kind: "live",
  defaultInfo: {},
  channelTitle: () => "YouTube 直播热门",
  channelLink: "https://www.youtube.com/",
  fetchPage: async (): Promise<Item[]> => {
    const shelves = await fetchYoutubeLiveShelves()
    const hot = shelves.find((s) => s.slug === "hot")
    if (!hot) throw new Error("youtube:live-hot 找不到 Live Now 栏目（直播页布局可能已变）")
    const t = now()
    return byViewers(hot.hits).map((hit) => youtubeLiveHitToLive("youtube:live-hot", hit, t))
  },
})
