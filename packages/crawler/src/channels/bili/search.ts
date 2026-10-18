/**
 * bili 搜索 —— 按关键词搜直播间(`search/type?search_type=live`,**匿名可用**)。
 *
 * 取数在 `resolve/platform/bili/discover.ts` 的 `searchBiliRooms`(含标题
 * `<em class="keyword">` 高亮剥离)。分页:页码制(page 从 1 起,page_size 真消费)。
 *
 * ⚠️ 同平台的分区列房(`second/getList`)需登录态,未做——见 docs/capability-gaps.md。
 */
import type { Item } from "@amoeba/xml"
import { type SerializeOptions } from "@amoeba/xml"
import type { Pageable, RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch, apiFetchMore } from "../factory.ts"
import { searchBiliRooms } from "@amoeba/resolve"

const PAGE = 20

export class BiliSearchChannel implements RssChannel {
  readonly key = "bili:search"
  readonly name = "B站搜索"
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
    if (!kw) throw new Error("bili:search 需要 keyword 参数")
    return searchBiliRooms(kw, page, PAGE)
  }

  private channelOptions(info: SourceInfo): SerializeOptions {
    return { channelTitle: `B站搜索 ${info.keyword ?? ""}`, channelLink: "https://live.bilibili.com/" }
  }
}
