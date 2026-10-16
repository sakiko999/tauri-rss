/**
 * bili:square —— bilibili 热搜(article channel)。
 *
 * wbi 签名(signWeb)→ search/square 热搜榜。零登录可用。
 */
import type { Article, Item } from "@amoeba/xml"
import { type SerializeOptions } from "@amoeba/xml"
import type { RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch } from "../factory.ts"
import { now } from "@amoeba/resolve"
import { biliClient } from "@amoeba/resolve"
import { API } from "./video-common.ts"

export class BiliSquareChannel implements RssChannel {
  readonly key = "bili:square"
  readonly name = "bilibili 热搜"
  readonly kind = "article" as const
  getSource(info: SourceInfo): RssSource {
    return { fetch: apiFetch(() => this.fetchItems(info), () => this.channelOptions(info)) }
  }
  private async fetchItems(_info: SourceInfo): Promise<Item[]> {
    const signed = await biliClient.signWeb("limit=50&platform=web")
    const data = await biliClient.getJson<{ data?: { trending?: { list?: Array<Record<string, unknown>> } } }>(
      `${API}/x/web-interface/wbi/search/square?${signed}`,
    )
    const list = data?.data?.trending?.list ?? []
    const t = now()
    return list.map((raw) => {
      const keyword = String(raw.keyword ?? "")
      const link =
        String(raw.link ?? raw.goto ?? "") ||
        `https://search.bilibili.com/all?${new URLSearchParams({ keyword })}&from_source=webtop_search`
      return {
        // ⚠️ id 只用**词**(不加下标):榜单刷新后词位次会移动,下标入 id 会让同一词
        // 因位次变化被当成新条目反复进库(与 weibo:hot / douyin:trend 同款约定)。
        id: `bili-rank-${keyword}`,
        sourceId: "bili:square",
        kind: "article",
        title: keyword,
        url: link,
        summary: raw["icon"] ? `<img src="${raw.icon}">` : undefined,
        content: `<p>${keyword}</p>`,
        contentFormat: "html",
        fetchedAt: t,
        raw,
      } satisfies Article
    })
  }
  private channelOptions(_info: SourceInfo): SerializeOptions {
    return { channelTitle: "bilibili 热搜", channelLink: "https://www.bilibili.com/" }
  }
}
