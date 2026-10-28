/**
 * huya 搜主播 —— 按关键词搜主播(`search.cdn.huya.com`,`v=1`)。
 *
 * 与 `live:huya:search`(搜房间,`v=4`)同端点,差别只在 `v` 与取哪个桶
 * (`response["1"]` = 主播)。取数在 `resolve/platform/huya/discover.ts`。
 *
 * ⚠️ **不可分页**:v=1 的 `start` 实测有效但语义怪异(start>0 恒返 40 条、与
 * rows 无关,窗口对齐不直观),暂不接 Pageable。`rows` 服务端封顶 50 ——
 * 2026-10-27 起取 rows=50(此前 rows=20 只见 20/50)。
 */

import { searchHuyaAnchors } from "@amoeba/resolve"

import { makeApiChannel } from "../factory.ts"

const PAGE = 50

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
