import { fetchDouyinPartitionRooms } from "@amoeba/resolve"

/**
 * douyin 分区房间 —— 按分区列直播间(参数化 `partition` + `partition_type`)。
 *
 * 与 `hot.ts` 同接口(`partition/detail/room/v2` + ABogus),差别只在分区参数:
 * hot.ts 硬编码「综合」(partition=720, type=1);本 channel 由用户给分区 id。
 *
 * ⚠️ **partition_type 必须与 id 配套**(实测 2026-09):顶层分区(聊天/音乐/游戏…)
 * type=4,子分区(射击游戏/竞技游戏…)type=1。传错取不到数据。分区树见
 * `resolve/platform/douyin/discover.ts`(`fetchDouyinCategories`)。
 */
import { makeApiChannel } from "../factory.ts"

const COUNT = 15

export const DouyinCategoryChannel = makeApiChannel({
  key: "live:douyin:category",
  name: "抖音分区直播",
  kind: "live",
  sourceInfoTpl: [
    { key: "partition", label: "分区 ID(如 1=射击游戏、101=聊天)", required: true },
    { key: "partitionType", label: "分区类型(顶层 4 / 子分区 1)", required: true, placeholder: "1" },
  ],
  channelTitle: (info) => `抖音分区直播 ${info.partition ?? ""}`,
  channelLink: "https://live.douyin.com",
  // 上游是 offset 游标(首页 offset=0,翻页每页 COUNT 条递增);这里用 page 表达:
  // offset = (page - 1) * COUNT。本页为空即止。
  pageable: { first: 2, step: 1 },
  fetchPage: async (info, page) => {
    const partition = String(info.partition ?? "").trim()
    const partitionType = String(info.partitionType ?? "1").trim()
    if (!partition) throw new Error("douyin:category 需要 partition 参数")
    return fetchDouyinPartitionRooms(partition, partitionType, (page - 1) * COUNT, COUNT, "live:douyin:category")
  },
})
