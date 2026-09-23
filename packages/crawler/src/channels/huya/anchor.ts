/**
 * huya 搜主播 —— 按关键词搜主播(`search.cdn.huya.com`,`v=1`)。
 *
 * 与 `live:huya:search`(搜房间,`v=4`)同端点,差别只在 `v` 与取哪个桶
 * (`response["1"]` = 主播)。取数在 `resolve/platform/huya/discover.ts`。
 *
 * ⚠️ **不可分页**(接口 `start` 实测无效,同搜房间)。
 */
import type { Item } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch } from "../factory.ts"
import { searchHuyaAnchors } from "@tauri-playground/resolve"

const PAGE = 20

export class HuyaAnchorChannel implements RssChannel {
  readonly key = "live:huya:anchor"
  readonly name = "虎牙搜主播"
  readonly kind = "live" as const
  readonly sourceInfoTpl = [{ key: "keyword", label: "主播关键词", required: true }]

  getSource(info: SourceInfo): RssSource {
    return {
      fetch: apiFetch(() => this.fetchItems(info), () => this.channelOptions(info)),
    }
  }

  private async fetchItems(info: SourceInfo): Promise<Item[]> {
    const kw = String(info.keyword ?? "").trim()
    if (!kw) throw new Error("huya:anchor 需要 keyword 参数")
    return searchHuyaAnchors(kw, PAGE)
  }

  private channelOptions(info: SourceInfo): SerializeOptions {
    return { channelTitle: `虎牙主播 ${info.keyword ?? ""}`, channelLink: "https://www.huya.com/" }
  }
}
