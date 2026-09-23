/**
 * douyin 搜索 —— 按关键词搜直播间。
 *
 * ⚠️ 实测 2026-09:抖音三路搜索中**只有第三路匿名可用**——
 * `aweme/v1/web/live/search` 与 `general/search/stream` 均返 `2483 请先登录`
 * (参照项目同款路径,但它带登录 cookie)。本实现走匿名的
 * `webcast/web/partition/search`(关键词命中分区 → 列各分区房间)。
 * 详见 `resolve/platform/douyin/discover.ts` 文件头。
 *
 * ⚠️ **不可分页**:上游是「关键词→分区→列房」的合成结果,无页码语义
 * (page 参数被忽略),故不声明 Pageable。
 *
 * ⚠️ **只对游戏名级关键词有效**:命中源 `partition/search` 只按分区名匹配,
 * `原神` 有结果而 `舞蹈`/`美食` 返空(此类词需登录走 aweme 搜索路)。
 */
import type { Item } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch } from "../factory.ts"
import { searchDouyinRooms } from "@tauri-playground/resolve"

const PAGE_SIZE = 20

export class DouyinSearchChannel implements RssChannel {
  readonly key = "live:douyin:search"
  readonly name = "抖音搜索"
  readonly kind = "live" as const
  readonly sourceInfoTpl = [{ key: "keyword", label: "搜索关键词", required: true }]

  getSource(info: SourceInfo): RssSource {
    return {
      fetch: apiFetch(() => this.fetchItems(info), () => this.channelOptions(info)),
    }
  }

  private async fetchItems(info: SourceInfo): Promise<Item[]> {
    const kw = String(info.keyword ?? "").trim()
    if (!kw) throw new Error("douyin:search 需要 keyword 参数")
    return searchDouyinRooms(kw, 1, PAGE_SIZE)
  }

  private channelOptions(info: SourceInfo): SerializeOptions {
    return { channelTitle: `抖音搜索 ${info.keyword ?? ""}`, channelLink: "https://live.douyin.com" }
  }
}
