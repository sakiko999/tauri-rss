/**
 * huya 搜索 —— 按关键词搜直播间(`search.cdn.huya.com`,**零鉴权**)。
 *
 * 取数在 `resolve/platform/huya/discover.ts` 的 `searchHuyaRooms`(含
 * 「房间桶 room_id 可能错,用 uid+yyid 去主播桶修正」的坑)。
 *
 * ⚠️ **不可分页**:接口的 `start` 参数实测无效——`start=0` 返 20 条,
 * `start>=20` 一律返同一批 40 条(首条相同,与 start 值无关)。故只取首页、
 * 不声明 Pageable(避免下游翻页拿到重复结果)。
 */
import { makeApiChannel } from "../factory.ts"
import { searchHuyaRooms } from "@amoeba/resolve"

const PAGE = 20

export const HuyaSearchChannel = makeApiChannel({
  key: "live:huya:search",
  name: "虎牙搜索",
  kind: "live",
  sourceInfoTpl: [{ key: "keyword", label: "搜索关键词", required: true }],
  channelTitle: (info) => `虎牙搜索 ${info.keyword ?? ""}`,
  channelLink: "https://www.huya.com/",
  fetchPage: async (info, page) => {
    const kw = String(info.keyword ?? "").trim()
    if (!kw) throw new Error("huya:search 需要 keyword 参数")
    return searchHuyaRooms(kw, page, PAGE)
  },
})
