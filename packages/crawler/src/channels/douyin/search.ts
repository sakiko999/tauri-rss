import { searchDouyinRooms } from "@amoeba/resolve"

/**
 * douyin **分区搜索** —— 按分区关键词列直播间（**不是**主播/房间标题搜索）。
 *
 * ⚠️ 实测 2026-09：抖音三路搜索中**只有第三路匿名可用**——
 * `aweme/v1/web/live/search` 与 `general/search/stream` 均返 `2483 请先登录`
 * （参照项目同款路径，但它带登录 cookie）。本实现走匿名的
 * `webcast/web/partition/search`（关键词命中分区 → 列各分区房间）。
 * 详见 `resolve/platform/douyin/discover.ts` 文件头。
 *
 * ⚠️ **本质是搜分区**：输入「原神」「舞蹈」「游戏」才命中；输入主播名
 * （如「旭旭宝宝」）或三级词（如「美食」）返回 0 条。已知主播请用
 * `live:douyin`（抖音号）或 `live:douyin:user`（主页链接）。
 *
 * ⚠️ **不可分页**：上游是「关键词→分区→列房」的合成结果，无页码语义
 * （page 参数被忽略），故不声明 Pageable。
 *
 * ✅ **命中断面（2026-10 增强）**：上游 `partition/search` 只认**游戏名级**分区
 * （`原神` 命中，`舞蹈`/`音乐` 返空）——但顶层分区名**恰恰就是这些词**
 * （聊天/音乐/游戏/二次元/舞蹈/文化/生活/运动）。故 resolve 侧改为
 * **上游命中 ∪ 本地分区树 title 匹配**（见 `searchDouyinRooms`），无需登录、无需浏览器。
 * 残留：分区树只到「大类」粒度，`美食`（属「生活」）这类三级词仍返空。
 */
import { makeApiChannel } from "../factory.ts"

const PAGE_SIZE = 20

export const DouyinPartitionSearchChannel = makeApiChannel({
  key: "live:douyin:search",
  name: "抖音分区搜索",
  kind: "live",
  sourceInfoTpl: [{ key: "keyword", label: "分区关键词", required: true, placeholder: "如 原神 / 舞蹈 / 音乐 / 游戏" }],
  channelTitle: (info) => `抖音分区搜索 ${info.keyword ?? ""}`,
  channelLink: "https://live.douyin.com",
  fetchPage: async (info) => {
    const kw = String(info.keyword ?? "").trim()
    if (!kw) throw new Error("douyin:search 需要分区关键词")
    return searchDouyinRooms(kw, 1, PAGE_SIZE)
  },
})
