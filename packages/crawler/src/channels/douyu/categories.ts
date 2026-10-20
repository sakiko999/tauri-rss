/**
 * live:douyu:categories —— 斗鱼分区目录**订阅**。
 *
 * 内容 = `cate/list` 的二级分区(一级分区没有直接列房接口),每条 `kind:"category"`;
 * 点开用 `live:douyu:category` + `{areaId}` 预览该分区房间,并可按同一份参数订阅。
 */
import type { Category, Item } from "@amoeba/xml"
import { type SerializeOptions } from "@amoeba/xml"
import type { RssChannel, RssSource } from "../../index.ts"
import { apiFetchItems } from "../factory.ts"
import { fetchDouyuCategories, now, type DouyuCategory } from "@amoeba/resolve"

/** 分区树 → 目录条目(纯函数):只列二级分区。 */
export function douyuCategoryItems(sourceId: string, t: number, tree: DouyuCategory[]): Item[] {
  return tree.flatMap((c) =>
    c.children.map(
      (sub): Category => ({
        id: `douyu-area:${sub.id}`,
        sourceId,
        kind: "category",
        title: sub.name,
        summary: c.name,
        fetchedAt: t,
        categoryChannel: "live:douyu:category",
        categoryInfo: { areaId: sub.id },
      }),
    ),
  )
}

export class DouyuCategoriesChannel implements RssChannel {
  readonly key = "live:douyu:categories"
  readonly name = "斗鱼分区列表"
  readonly kind = "category" as const
  readonly defaultInfo = {}

  getSource(): RssSource {
    return { fetch: apiFetchItems(() => this.fetchItems(), () => this.channelOptions()) }
  }

  private async fetchItems(): Promise<Item[]> {
    return douyuCategoryItems("live:douyu:categories", now(), await fetchDouyuCategories())
  }

  private channelOptions(): SerializeOptions {
    return { channelTitle: "斗鱼分区列表", channelLink: "https://www.douyu.com/" }
  }
}
