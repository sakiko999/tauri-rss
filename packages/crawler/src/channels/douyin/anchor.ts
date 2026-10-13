/**
 * douyin 搜主播 —— 按主播名搜**在播房间**。
 *
 * ⚠️ **没有匿名主播搜索接口**(`aweme/v1/web/live/search` 2483 需登录,与房间搜索同门槛;
 * browser 模拟也解不了——账号硬门槛,非 TLS 指纹)。本实现走**本地过滤**:
 * 抓「综合热门流 + 命中关键词的分区流」的房间,按 `owner.nickname` 匹配
 * (见 `resolve/platform/douyin/discover.ts` 的 `searchDouyinAnchors`)。
 *
 * 局限(体现在文案):只能命中**当前在播**的主播,且受扫描量限制(热门 + 前 3 分区);
 * 但零登录、零新接口、匿名可用 —— 补上 `docs/capability-gaps.md` 记的「抖音搜主播未做」。
 *
 * ⚠️ **不可分页**:无页码语义(本地过滤合成结果),不声明 Pageable。
 */
import type { Item } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch } from "../factory.ts"
import { searchDouyinAnchors } from "@tauri-playground/resolve"

const PAGE_SIZE = 20

export class DouyinAnchorChannel implements RssChannel {
  readonly key = "live:douyin:anchor"
  readonly name = "抖音搜主播"
  readonly kind = "live" as const
  readonly sourceInfoTpl = [{ key: "keyword", label: "主播名", required: true }]

  getSource(info: SourceInfo): RssSource {
    return {
      fetch: apiFetch(() => this.fetchItems(info), () => this.channelOptions(info)),
    }
  }

  private async fetchItems(info: SourceInfo): Promise<Item[]> {
    const kw = String(info.keyword ?? "").trim()
    if (!kw) throw new Error("douyin:anchor 需要 keyword 参数(主播名)")
    return (await searchDouyinAnchors(kw)).slice(0, PAGE_SIZE)
  }

  private channelOptions(info: SourceInfo): SerializeOptions {
    return { channelTitle: `抖音主播 ${info.keyword ?? ""}`, channelLink: "https://live.douyin.com" }
  }
}
