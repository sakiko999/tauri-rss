/**
 * bili 搜主播 —— 按关键词搜主播(`search/type?search_type=live_user`,匿名可用)。
 *
 * 取数在 `resolve/platform/bili/discover.ts` 的 `searchBiliAnchors`。
 * 分页:页码制(page 从 1 起)。⚠️ 该接口**无 `page_size`**(与搜房间相异),
 * 服务端固定每页条数。
 */
import type { Item } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { Pageable, RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch, apiFetchMore } from "../factory.ts"
import { searchBiliAnchors } from "@tauri-playground/resolve"

export class BiliAnchorChannel implements RssChannel {
  readonly key = "bili:anchor"
  readonly name = "bilibili 搜主播"
  readonly kind = "live" as const
  readonly sourceInfoTpl = [{ key: "keyword", label: "主播关键词", required: true }]

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
    if (!kw) throw new Error("bili:anchor 需要 keyword 参数")
    return searchBiliAnchors(kw, page)
  }

  private channelOptions(info: SourceInfo): SerializeOptions {
    return { channelTitle: `bilibili 主播 ${info.keyword ?? ""}`, channelLink: "https://live.bilibili.com/" }
  }
}
