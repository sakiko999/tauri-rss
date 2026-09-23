/**
 * douyu 分区房间 —— 按二级分区列直播间(`areaId` = cate2Id)。
 *
 * 分区树(一级/二级)见 `resolve/platform/douyu/discover.ts` 的
 * `fetchDouyuCategories`(一次返回全部,内存关联)。本 channel 参数 = 二级分区 id。
 *
 * 分页:页码制(page 在 path 里,从 1 起);服务端每页固定条数。
 */
import type { Item, Live } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { Pageable, RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch, apiFetchMore } from "../factory.ts"
import { fetchDouyuCategoryRooms } from "@tauri-playground/resolve"

export class DouyuCategoryChannel implements RssChannel {
  readonly key = "live:douyu:category"
  readonly name = "斗鱼分区直播"
  readonly kind = "live" as const
  readonly sourceInfoTpl = [{ key: "areaId", label: "分区 ID(如 1=英雄联盟、181=王者荣耀)", required: true }]

  getSource(info: SourceInfo): RssSource & Pageable {
    return {
      fetch: apiFetch(() => this.fetchItems(info, 1), () => this.channelOptions(info)),
      fetchMore: apiFetchMore((page) => this.fetchItems(info, page), () => this.channelOptions(info), {
        first: 2,
        step: 1,
      }),
    }
  }

  private async fetchItems(info: SourceInfo, page: number): Promise<Item[]> {
    const areaId = String(info.areaId ?? "").trim()
    if (!areaId) throw new Error("douyu:category 需要 areaId 参数")
    return fetchDouyuCategoryRooms(areaId, page)
  }

  private channelOptions(info: SourceInfo): SerializeOptions {
    return { channelTitle: `斗鱼分区直播 ${info.areaId ?? ""}`, channelLink: "https://www.douyu.com/" }
  }
}
