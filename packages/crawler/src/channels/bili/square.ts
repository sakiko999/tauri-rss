/**
 * bili:square —— bilibili 热搜(social channel)。
 *
 * ⚠️ kind 是 **social** 而非 article:条目是**热搜词条**(关键词),不是可读文章。
 * 曾在 article 下 —— 词条于是混进「阅读」列表、被一键归类塞进「文章」组,点开还是
 * 一个只有关键词的空正文。与 weibo:hot / douyin:trend 同款语义:热搜榜统一走 social。
 *
 * wbi 签名(signWeb)→ search/square 热搜榜。零登录可用;登录 cookie 经
 * credentials provider 兜底(签名与请求同 cookie,见 bili client)。
 */

import { biliClient, now } from "@amoeba/resolve"
import type { Item, Social } from "@amoeba/xml"

import { makeApiChannel } from "../factory.ts"
import { API } from "./video-common.ts"

export const BiliSquareChannel = makeApiChannel({
  key: "bili:square",
  name: "B站热搜",
  kind: "social",
  channelTitle: () => "B站热搜",
  channelLink: "https://www.bilibili.com/",
  fetchPage: async (info) => {
    const signed = await biliClient.signWeb("limit=50&platform=web", info.cookie)
    const data = await biliClient.getJson<{ data?: { trending?: { list?: Array<Record<string, unknown>> } } }>(
      `${API}/x/web-interface/wbi/search/square?${signed}`,
      { cookie: info.cookie },
    )
    const list = data?.data?.trending?.list ?? []
    return squareItems(list, now())
  },
})

/**
 * 热搜原始条目 → 订阅条目。**导出给自检**:core 归类看的是条目级 `tpl:kind`
 * (item.kind),渠道上声明的 `kind` 只是元数据 —— 只断言渠道 kind 的话,
 * 把这里的 "social" 改回 "article" 检查照样全绿(词条会重新混进阅读流)。
 */
export function squareItems(list: Array<Record<string, unknown>>, t: number): Item[] {
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
      kind: "social",
      title: keyword,
      url: link,
      thumbnail: typeof raw["icon"] === "string" ? raw["icon"] : undefined,
      // ⚠️ 纯文本,不包 <p>:social 卡片按文本渲染 content(见 SocialCard),
      // 带标签会原样显示 `<p>词条</p>`。与 weibo:hot / douyin:trend 同款。
      content: keyword,
      fetchedAt: t,
      raw,
    } satisfies Social
  })
}
