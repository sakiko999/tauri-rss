/**
 * bili:square —— bilibili 热搜(article channel)。
 *
 * wbi 签名(signWeb)→ search/square 热搜榜。零登录可用;登录 cookie 经
 * credentials provider 兜底(签名与请求同 cookie,见 bili client)。
 */
import type { Article, Item } from "@amoeba/xml"
import { biliClient, now } from "@amoeba/resolve"
import { makeApiChannel } from "../factory.ts"
import { API } from "./video-common.ts"

export const BiliSquareChannel = makeApiChannel({
  key: "bili:square",
  name: "B站热搜",
  kind: "article",
  channelTitle: () => "B站热搜",
  channelLink: "https://www.bilibili.com/",
  fetchPage: async (info) => {
    const signed = await biliClient.signWeb("limit=50&platform=web", info.cookie)
    const data = await biliClient.getJson<{ data?: { trending?: { list?: Array<Record<string, unknown>> } } }>(
      `${API}/x/web-interface/wbi/search/square?${signed}`,
      { cookie: info.cookie },
    )
    const list = data?.data?.trending?.list ?? []
    const t = now()
    return list.map((raw): Item => {
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
  },
})
