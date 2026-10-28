/**
 * douyu 搜主播 —— 按关键词搜主播(`japi/search/api/searchUser`,匿名可用)。
 *
 * 取数在 `resolve/platform/douyu/discover.ts` 的 `searchDouyuAnchors`。
 * 分页:页码制(page 从 1 起,pageSize 真消费)。
 */

import { searchDouyuAnchors } from "@amoeba/resolve"

import { makeApiChannel } from "../factory.ts"

const PAGE = 20

export const DouyuAnchorChannel = makeApiChannel({
  key: "live:douyu:anchor",
  name: "斗鱼搜主播",
  kind: "live",
  sourceInfoTpl: [{ key: "keyword", label: "主播关键词", required: true }],
  channelTitle: (info) => `斗鱼主播 ${info.keyword ?? ""}`,
  channelLink: "https://www.douyu.com/",
  pageable: { first: 2, step: 1 },
  fetchPage: async (info, page) => {
    const kw = String(info.keyword ?? "").trim()
    if (!kw) throw new Error("douyu:anchor 需要 keyword 参数")
    return searchDouyuAnchors(kw, page, PAGE)
  },
})
