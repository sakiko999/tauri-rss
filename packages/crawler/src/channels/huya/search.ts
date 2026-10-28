/**
 * huya 搜索 —— 按关键词搜直播间(`search.cdn.huya.com`,**零鉴权**)。
 *
 * 取数在 `resolve/platform/huya/discover.ts` 的 `searchHuyaRooms`(含
 * 「房间桶 room_id 可能错,用 uid+yyid 去主播桶修正」的坑)。
 *
 * ⚠️ **不可分页**:接口的 `start` 参数实测无效(服务端只回显、不换窗口)。
 * 但 `rows` 是真实的深度杠杆(~100 封顶):2026-10-27 起取 rows=100 一次拿全
 * (英雄联盟 numFound≈97;此前 rows=20 只见 20/97)。不声明 Pageable(start
 * 翻不动,翻页只会拿到同一批)。
 */

import { searchHuyaRooms } from "@amoeba/resolve"

import { makeApiChannel } from "../factory.ts"

const PAGE = 100

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
