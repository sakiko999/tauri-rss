/**
 * youtube:live-categories —— YouTube 直播栏目目录**订阅**。
 *
 * 内容 = Live 页的编辑栏目(`Live Now - News/Gaming/Sports` 等),每条
 * `kind:"category"`;点开用 `youtube:live-category` + `{category: slug}` 预览该栏目
 * 正在直播的内容,并可按同一份参数订阅。
 *
 * ⚠️ `Live Now` 本身不是栏目(它是「直播热门」,归 `youtube:live-hot`),不列入。
 * 被 LIVE badge 过滤成空栏目的(Recent/Upcoming)也不列入。
 */
import type { Category, Item } from "@amoeba/xml"
import { type SerializeOptions } from "@amoeba/xml"
import type { RssChannel, RssSource } from "../../index.ts"
import { apiFetchItems } from "../factory.ts"
import { fetchYoutubeLiveShelves, now } from "@amoeba/resolve"

export class YoutubeLiveCategoriesChannel implements RssChannel {
  readonly key = "youtube:live-categories"
  readonly name = "YouTube 直播栏目"
  readonly kind = "category" as const
  readonly defaultInfo = {}

  getSource(): RssSource {
    return { fetch: apiFetchItems(() => this.fetchItems(), () => this.channelOptions()) }
  }

  private async fetchItems(): Promise<Item[]> {
    const shelves = await fetchYoutubeLiveShelves()
    const t = now()
    return shelves
      .filter((s) => s.slug !== "hot" && s.hits.length > 0)
      .map(
        (s): Category => ({
          id: `youtube-shelf:${s.slug}`,
          sourceId: "youtube:live-categories",
          kind: "category",
          title: s.title.replace(/^live now\s*-\s*/i, ""),
          url: "https://www.youtube.com/live",
          summary: `${s.hits.length} 个直播`,
          thumbnail: s.hits[0]?.thumb,
          fetchedAt: t,
          categoryChannel: "youtube:live-category",
          categoryInfo: { category: s.slug },
        }),
      )
  }

  private channelOptions(): SerializeOptions {
    return { channelTitle: "YouTube 直播栏目", channelLink: "https://www.youtube.com/live" }
  }
}
