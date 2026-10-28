/**
 * live:huya:categories —— 虎牙分区目录**订阅**。
 *
 * 顶层 4 个是平台固定枚举(无接口),二级分区各拉一次 `bussLive`;每条
 * `kind:"category"`,点开用 `live:huya:category` + `{gameId}` 预览并订阅。
 * 单个顶层失败不影响其余;全部为空才抛错(不能静默给空目录)。
 */
import type { Category, Item } from "@amoeba/xml"
import { type SerializeOptions } from "@amoeba/xml"
import type { RssChannel, RssSource } from "../../index.ts"
import { apiFetchItems } from "../factory.ts"
import { fetchHuyaSubCategories, HUYA_TOP_CATEGORIES, now, type HuyaSubCategory } from "@amoeba/resolve"

/** 二级分区 → 目录条目(纯函数,便于自检)。 */
export function huyaCategoryItems(sourceId: string, t: number, subs: HuyaSubCategory[]): Item[] {
  return subs.map((s): Category => ({
    id: `huya-game:${s.id}`,
    sourceId,
    kind: "category",
    title: s.name,
    summary: s.parentName,
    fetchedAt: t,
    categoryChannel: "live:huya:category",
    categoryInfo: { gameId: s.id },
  }))
}

/**
 * 保留类实现(不走 makeApiChannel):N 个顶层分区聚合 —— 每区独立 try/catch 隔离、
 * 全部为空才抛错;且 getSource 不依赖 info。属聚合护栏,非单端点同形。
 */
export class HuyaCategoriesChannel implements RssChannel {
  readonly key = "live:huya:categories"
  readonly name = "虎牙分区列表"
  readonly kind = "category" as const
  readonly defaultInfo = {}

  getSource(): RssSource {
    return {
      fetch: apiFetchItems(
        () => this.fetchItems(),
        () => this.channelOptions(),
      ),
    }
  }

  private async fetchItems(): Promise<Item[]> {
    const groups = await Promise.all(
      HUYA_TOP_CATEGORIES.map(async (top) => {
        try {
          return await fetchHuyaSubCategories(top.id)
        } catch {
          return []
        }
      }),
    )
    const subs = groups.flat()
    if (!subs.length) throw new Error("huya: 分区列表拉取失败")
    return huyaCategoryItems("live:huya:categories", now(), subs)
  }

  private channelOptions(): SerializeOptions {
    return { channelTitle: "虎牙分区列表", channelLink: "https://www.huya.com/" }
  }
}
