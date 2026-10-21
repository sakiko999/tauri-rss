/**
 * bili:live:areas —— B站直播分区目录**订阅**。
 *
 * 内容 = Area/getList 分区树(顶层 + 二级一次返回,匿名可读),每条 `kind:"category"`;
 * 点开用 `bili:live:area` + `{parentAreaId, areaId}` 预览该分区房间,并可按同一份参数
 * 订阅。顶层条目 `areaId="0"`(second/getList 接受,列该父分区全部)。
 *
 * ⚠️ 目录本身匿名可读;点进的分区列房**需登录**(见 area.ts)。
 */
import type { Category, Item } from "@amoeba/xml"
import { makeApiChannel } from "../factory.ts"
import { fetchBiliCategories, now, type BiliCategory } from "@amoeba/resolve"

/** 分区树 → 目录条目(纯函数,便于自检);跳过空 id 子分区。 */
export function biliCategoryItems(sourceId: string, t: number, tree: BiliCategory[]): Item[] {
  const out: Item[] = []
  const push = (id: string, title: string, summary: string, parentId: string, areaId: string) => {
    const c: Category = {
      id,
      sourceId,
      kind: "category",
      title,
      url: `https://live.bilibili.com/p/eden/area-tags?parentAreaId=${parentId}&areaId=${areaId}`,
      summary,
      fetchedAt: t,
      categoryChannel: "bili:live:area",
      categoryInfo: { parentAreaId: parentId, areaId },
    }
    out.push(c)
  }
  for (const p of tree) {
    push(`bili-area:${p.id}`, p.name, p.children.length ? `${p.children.length} 个子分区` : "顶层分区", p.id, "0")
    for (const sub of p.children) {
      if (!sub.id) continue
      push(`bili-area:${p.id}:${sub.id}`, sub.name, `${p.name} · 子分区`, p.id, sub.id)
    }
  }
  return out
}

export const BiliLiveAreasChannel = makeApiChannel({
  key: "bili:live:areas",
  name: "B站直播分区列表",
  kind: "category",
  defaultInfo: {},
  channelTitle: () => "B站直播分区列表",
  channelLink: "https://live.bilibili.com/p/eden/area-tags",
  fetchPage: async (): Promise<Item[]> =>
    biliCategoryItems("bili:live:areas", now(), await fetchBiliCategories()),
})
