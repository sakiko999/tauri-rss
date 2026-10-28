import { fetchDouyuCategoryRooms } from "@amoeba/resolve"

/**
 * douyu 分区房间 —— 按二级分区列直播间(`areaId` = cate2Id)。
 *
 * 分区树(一级/二级)见 `resolve/platform/douyu/discover.ts` 的
 * `fetchDouyuCategories`(一次返回全部,内存关联)。本 channel 参数 = 二级分区 id。
 *
 * 分页:页码制(page 在 path 里,从 1 起);服务端每页固定条数。
 */
import { makeApiChannel } from "../factory.ts"

export const DouyuCategoryChannel = makeApiChannel({
  key: "live:douyu:category",
  name: "斗鱼分区直播",
  kind: "live",
  sourceInfoTpl: [{ key: "areaId", label: "分区 ID(如 1=英雄联盟、181=王者荣耀)", required: true }],
  channelTitle: (info) => `斗鱼分区直播 ${info.areaId ?? ""}`,
  channelLink: "https://www.douyu.com/",
  pageable: { first: 2, step: 1 },
  fetchPage: async (info, page) => {
    const areaId = String(info.areaId ?? "").trim()
    if (!areaId) throw new Error("douyu:category 需要 areaId 参数")
    return fetchDouyuCategoryRooms(areaId, page)
  },
})
