import { searchHuyaAnchors } from "@amoeba/resolve"

/**
 * huya 搜主播 —— 按关键词搜主播(`search.cdn.huya.com`,`v=1`)。
 *
 * 与 `live:huya:search`(搜房间,`v=4`)同端点,差别只在 `v` 与取哪个桶
 * (`response["1"]` = 主播)。取数在 `resolve/platform/huya/discover.ts`。
 *
 * ⚠️ **不可分页**(接口 `start` 实测无效,同搜房间)。
 */
import { makeApiChannel } from "../factory.ts"

const PAGE = 20

export const HuyaAnchorChannel = makeApiChannel({
  key: "live:huya:anchor",
  name: "虎牙搜主播",
  kind: "live",
  sourceInfoTpl: [{ key: "keyword", label: "主播关键词", required: true }],
  channelTitle: (info) => `虎牙主播 ${info.keyword ?? ""}`,
  channelLink: "https://www.huya.com/",
  fetchPage: async (info) => {
    const kw = String(info.keyword ?? "").trim()
    if (!kw) throw new Error("huya:anchor 需要 keyword 参数")
    return searchHuyaAnchors(kw, PAGE)
  },
})
