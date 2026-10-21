/**
 * twitch:categories —— Twitch 分类目录**订阅**。
 *
 * 它产出的内容就是分类列表(每条 `kind:"category"`);点开一条 → UI 用
 * `categoryChannel` + `categoryInfo`(`twitch:category` + `{category: slug}`)
 * 预览该分类的直播间,并可按同一份参数订阅该分类。
 *
 * ⚠️ 分类本身没有可播房间,所以它不是 live item —— 只是一个「指向订阅」的目录条目。
 * ⚠️ `games(first)` 匿名可用,实测 30 个分类(slug/name/观看数/封面)。
 */
import type { Category, Item } from "@amoeba/xml"
import { makeApiChannel } from "../factory.ts"
import { fetchTwitchTopCategories, now } from "@amoeba/resolve"

export const TwitchCategoriesChannel = makeApiChannel({
  key: "twitch:categories",
  name: "Twitch 分区列表",
  kind: "category",
  defaultInfo: {},
  channelTitle: () => "Twitch 分区列表",
  channelLink: "https://www.twitch.tv/directory",
  fetchPage: async (): Promise<Item[]> => {
    const games = await fetchTwitchTopCategories(30)
    const t = now()
    return games.map(
      (g): Category => ({
        id: `twitch-category:${g.slug}`,
        sourceId: "twitch:categories",
        kind: "category",
        title: g.name || g.slug,
        url: `https://www.twitch.tv/directory/category/${g.slug}`,
        summary: g.viewersCount ? `${g.viewersCount} 人在看` : undefined,
        thumbnail: g.boxArtURL ?? undefined,
        fetchedAt: t,
        categoryChannel: "twitch:category",
        categoryInfo: { category: g.slug },
      }),
    )
  },
})
