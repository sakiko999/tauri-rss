/**
 * bili 搜主播 —— 按关键词搜主播(`search/type?search_type=live_user`,匿名可用)。
 *
 * 取数在 `resolve/platform/bili/discover.ts` 的 `searchBiliAnchors`。
 * 分页:页码制(page 从 1 起)。⚠️ 该接口**无 `page_size`**(与搜房间相异),
 * 服务端固定每页条数。
 */
import { searchBiliAnchors } from "@amoeba/resolve"

import { makeApiChannel } from "../factory.ts"

export const BiliAnchorChannel = makeApiChannel({
  key: "bili:anchor",
  name: "B站搜主播",
  kind: "live",
  sourceInfoTpl: [{ key: "keyword", label: "主播关键词", required: true }],
  channelTitle: (info) => `B站主播 ${info.keyword ?? ""}`,
  channelLink: "https://live.bilibili.com/",
  pageable: { first: 2, step: 1 },
  fetchPage: async (info, page) => {
    const kw = String(info.keyword ?? "").trim()
    if (!kw) throw new Error("bili:anchor 需要 keyword 参数")
    return searchBiliAnchors(kw, page)
  },
})
