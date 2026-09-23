/**
 * douyu 搜索 —— 按关键词搜直播间(`japi/search/api/searchShow`,匿名可用)。
 *
 * 取数在 `resolve/platform/douyu/discover.ts` 的 `searchDouyuRooms`。
 * 分页:页码制(page 从 1 起,pageSize 真消费→可分页)。
 */
import type { Item } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { Pageable, RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch, apiFetchMore } from "../factory.ts"
import { searchDouyuRooms } from "@tauri-playground/resolve"

const PAGE = 20

export class DouyuSearchChannel implements RssChannel {
  readonly key = "live:douyu:search"
  readonly name = "斗鱼搜索"
  readonly kind = "live" as const
  readonly sourceInfoTpl = [{ key: "keyword", label: "搜索关键词", required: true }]

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
    const kw = String(info.keyword ?? "").trim()
    if (!kw) throw new Error("douyu:search 需要 keyword 参数")
    return searchDouyuRooms(kw, page, PAGE)
  }

  private channelOptions(info: SourceInfo): SerializeOptions {
    return { channelTitle: `斗鱼搜索 ${info.keyword ?? ""}`, channelLink: "https://www.douyu.com/" }
  }
}
