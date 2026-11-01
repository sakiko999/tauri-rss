/**
 * live:douyin:categories —— 抖音分区目录**订阅**。
 *
 * 内容 = 首页 SSR `categoryData` 的顶层 + 子分区,每条 `kind:"category"`;
 * 点开用 `live:douyin:category` 预览该分区房间,并可按同一份参数订阅。
 *
 * ⚠️ `categoryInfo` **必须同时带** `partition` 与 `partitionType`(顶层 4 / 子 1):
 * 只填第一个参数会把顶层分区当成子分区(1),上游取不到数据。
 */

import { type DouyinCategory, fetchDouyinCategories, now } from "@amoeba/resolve"
import type { Category, Item } from "@amoeba/xml"

import { makeApiChannel } from "../factory.ts"

/** 分区树 → 目录条目(纯函数,便于自检)。 */
export function douyinCategoryItems(sourceId: string, t: number, tree: DouyinCategory[]): Item[] {
  const out: Item[] = []
  for (const c of tree) {
    out.push(
      categoryItem(sourceId, t, {
        id: c.partition.id,
        title: c.partition.title,
        summary: c.subs.length ? `${c.subs.length} 个子分区` : "顶层分区",
        info: { partition: c.partition.id, partitionType: String(c.partition.type) },
      }),
    )
    for (const sub of c.subs) {
      out.push(
        categoryItem(sourceId, t, {
          id: sub.id,
          title: sub.title,
          summary: `${c.partition.title} · 子分区`,
          info: { partition: sub.id, partitionType: String(sub.type) },
        }),
      )
    }
  }
  return out
}

function categoryItem(
  sourceId: string,
  t: number,
  v: { id: string; title: string; summary: string; info: Record<string, string> },
): Category {
  return {
    id: `douyin-partition:${v.id}`,
    sourceId,
    kind: "category",
    title: v.title,
    summary: v.summary,
    fetchedAt: t,
    categoryChannel: "live:douyin:category",
    categoryInfo: v.info,
  }
}

export const DouyinCategoriesChannel = makeApiChannel({
  key: "live:douyin:categories",
  name: "抖音分区列表",
  kind: "category",
  defaultInfo: {},
  channelTitle: () => "抖音分区列表",
  channelLink: "https://live.douyin.com",
  fetchPage: async () => douyinCategoryItems("live:douyin:categories", now(), await fetchDouyinCategories()),
})
