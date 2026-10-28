import type { YoutubeLiveHit } from "@amoeba/resolve"
import { fetchYoutubeLiveShelves, normalizeYoutubeLiveCategory, now } from "@amoeba/resolve"
/**
 * youtube:live-hot / youtube:live-category —— YouTube 直播页栏目订阅。
 *
 * 两者共用一次 live 页解析(resolve `fetchYoutubeLiveShelves`,5 分钟缓存):
 *   - `youtube:live-hot`       取 `Live Now` 栏目(`slug === "hot"`);
 *   - `youtube:live-category`  参数 `category`(news / gaming / sports / 栏目名),
 *                              匹配 `Live Now - <栏目>`。
 *
 * 输出 `kind:"live"`,播放走既有 by-url 解析(`watch?v=<videoId>` → resolveYoutubeStreams)。
 * ⚠️ 只有栏目级分区(YouTube 当前给的编辑栏目),不是 Twitch 式完整分区树;无 continuation。
 * ⚠️ 按观看数降序(契约:列表顺序由渠道负责,默认选流/展示不依赖上游顺序)。
 */
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

/** `Live Now - <栏目>` 订阅。参数 `category`(必填)。 */
export const YoutubeLiveCategoryChannel = makeApiChannel({
  key: "youtube:live-category",
  name: "YouTube 直播栏目",
  kind: "live",
  sourceInfoTpl: [{ key: "category", label: "栏目（news / gaming / sports）", required: true }],
  channelTitle: (info) => `YouTube 直播 ${info.category ?? ""}`,
  channelLink: "https://www.youtube.com/",
  fetchPage: async (info): Promise<Item[]> => {
    const raw = info.category ?? ""
    const slug = normalizeYoutubeLiveCategory(raw)
    if (!slug) throw new Error("youtube:live-category 需要栏目（news / gaming / sports，或完整栏目名）")
    // `Live Now` 不是分区,归 youtube:live-hot(避免两个订阅同内容)。
    if (slug === "hot") throw new Error("youtube:live-category 不接 Live Now，请改用 youtube:live-hot")

    const shelves = await fetchYoutubeLiveShelves()
    const shelf = shelves.find((s) => s.slug === slug)
    if (!shelf) {
      const available = shelves.filter((s) => s.slug !== "hot" && s.hits.length).map((s) => s.slug)
      throw new Error(`youtube:live-category 没有栏目 ${slug}；可用：${available.join(" / ") || "（暂无）"}`)
    }
    const t = now()
    return byViewers(shelf.hits).map((hit) => youtubeLiveHitToLive("youtube:live-category", hit, t))
  },
})
