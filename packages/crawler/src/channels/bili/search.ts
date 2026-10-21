/**
 * bili 搜索 —— 按关键词搜直播间(`search/type?search_type=live`,**匿名可用**)。
 *
 * 取数在 `resolve/platform/bili/discover.ts` 的 `searchBiliRooms`(含标题
 * `<em class="keyword">` 高亮剥离);登录 cookie 经 credentials provider 兜底。
 * 分页:页码制(page 从 1 起,page_size 真消费)。
 *
 * ⚠️ 同平台的分区列房(`second/getList`)需登录态,未做——见 docs/capability-gaps.md。
 */
import { searchBiliRooms } from "@amoeba/resolve"
import { makeApiChannel } from "../factory.ts"

const PAGE = 20

export const BiliSearchChannel = makeApiChannel({
  key: "bili:search",
  name: "B站搜索",
  kind: "live",
  sourceInfoTpl: [{ key: "keyword", label: "搜索关键词", required: true }],
  channelTitle: (info) => `B站搜索 ${info.keyword ?? ""}`,
  channelLink: "https://live.bilibili.com/",
  pageable: { first: 2, step: 1 },
  fetchPage: async (info, page) => {
    const kw = String(info.keyword ?? "").trim()
    if (!kw) throw new Error("bili:search 需要 keyword 参数")
    return searchBiliRooms(kw, page, PAGE)
  },
})
