/**
 * douyu 搜索 —— 按关键词搜直播间(`japi/search/api/searchShow`,匿名可用)。
 *
 * 取数在 `resolve/platform/douyu/discover.ts` 的 `searchDouyuRooms`。
 * 分页:页码制(page 从 1 起,pageSize 真消费→可分页)。
 */
import { makeApiChannel } from "../factory.ts"
import { searchDouyuRooms } from "@amoeba/resolve"

const PAGE = 20

export const DouyuSearchChannel = makeApiChannel({
  key: "live:douyu:search",
  name: "斗鱼搜索",
  kind: "live",
  sourceInfoTpl: [{ key: "keyword", label: "搜索关键词", required: true }],
  channelTitle: (info) => `斗鱼搜索 ${info.keyword ?? ""}`,
  channelLink: "https://www.douyu.com/",
  pageable: { first: 2, step: 1 },
  fetchPage: async (info, page) => {
    const kw = String(info.keyword ?? "").trim()
    if (!kw) throw new Error("douyu:search 需要 keyword 参数")
    return searchDouyuRooms(kw, page, PAGE)
  },
})
