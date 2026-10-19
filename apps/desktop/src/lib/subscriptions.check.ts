/**
 * subscriptions.check —— 最小断言(仓库无测试基建,照 core/example/*.check.ts 惯例)。
 * 覆盖 valueList 的分支:列表型参数按逗号切、单值参数**不切**。
 *   bun apps/desktop/src/lib/subscriptions.check.ts
 */
import {
  candidatesFromSearch,
  candidatesFromUsers,
  mergeValues,
  multiParamOf,
  MULTI_PARAMS,
  SEARCH_CHANNEL,
  searchChannelOf,
  splitValues,
  valueList,
  subsHolding,
} from "./subscriptions.ts"
import type { ChannelInfo, LiveItem, MediaItem, Subscription } from "@amoeba/core"

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`ok  ${msg}`)
}

const sub = (info: Record<string, string>): Subscription =>
  ({ id: "s1", channelKey: "bili:live", title: "t", enabled: true, info, createdAt: 0, updatedAt: 0 }) as Subscription

// 列表型参数:按逗号切分
assert(
  JSON.stringify(valueList(sub({ roomIds: "6, 21452505 ," }), "roomIds")) === JSON.stringify(["6", "21452505"]),
  "roomIds 按逗号切分并 trim / 去空",
)

// ⚠️ 单值参数本身可能含逗号(「英雄联盟,王者」)—— 切了会误判成两个已订阅目标
assert(
  JSON.stringify(valueList(sub({ keyword: "英雄联盟,王者" }), "keyword")) === JSON.stringify(["英雄联盟,王者"]),
  "keyword 单值不按逗号切分",
)

assert(valueList(sub({ roomIds: "" }), "roomIds").length === 0, "空值 → 空列表")
assert(valueList(sub({}), undefined).length === 0, "参数名缺失 → 空列表")
assert(
  JSON.stringify(valueList(sub({ roomIds: "6", roomId: "998" }), "roomIds")) === JSON.stringify(["6"]),
  "只读 roomIds，不混入 legacy roomId",
)
// 合并已有订阅时也用同一把切分尺：中文逗号/空格/换行都算分隔
assert(
  JSON.stringify(splitValues("6，21452505 9\n10", "roomIds")) === JSON.stringify(["6", "21452505", "9", "10"]),
  "splitValues 支持中文逗号/空格/换行",
)
assert(JSON.stringify(splitValues("英雄联盟,王者", "keyword")) === JSON.stringify(["英雄联盟,王者"]), "splitValues 单值参数不切")

// multiParamOf:只有列表型参数能并入
const ch = (key: string, field: string): ChannelInfo =>
  ({ key, name: key, kind: "live", loginable: false, sourceInfoTpl: [{ key: field, label: field }] }) as ChannelInfo
assert(multiParamOf(ch("bili:live", "roomIds")) === true, "roomIds 渠道支持并入")
assert(multiParamOf(ch("bili:search", "keyword")) === false, "keyword 渠道不支持并入")

// subsHolding:多值订阅里任一项命中即算已存在
const subs = [sub({ roomIds: "6,21452505" }), { ...sub({ roomIds: "9" }), id: "s2" } as Subscription]
assert(subsHolding(subs, "bili:live", "roomIds", "21452505").length === 1, "并入命中第二条房间号")
assert(subsHolding(subs, "bili:live", "roomIds", "999").length === 0, "未收录的房号不命中")

// mergeValues:保留原顺序,新值去重后追加;重复项不重复加
const merged = mergeValues(["6", "21452505"], ["21452505", "9", "9"])
assert(JSON.stringify(merged.merged) === JSON.stringify(["6", "21452505", "9"]), "并入去重且保留原顺序")
assert(JSON.stringify(merged.added) === JSON.stringify(["9"]), "added 只含本次新增")

// 搜索渠道映射:每个登记平台都有对应 search channel;未登记平台返回 undefined(UI 降级手填)
assert(searchChannelOf("douyu") === "live:douyu:search", "douyu → 斗鱼搜索渠道")
assert(searchChannelOf("youtube") === "youtube:live-search", "youtube → 直播搜索渠道")
assert(searchChannelOf("douyin") === "live:douyin:search", "douyin → 抖音分区搜索渠道")
assert(Object.values(SEARCH_CHANNEL).every((k) => typeof k === "string"), "映射值为渠道 key 字符串")

// candidatesFromSearch:从接口条目派生候选(roomId 去重、无 roomId 丢弃)
const live = (roomId: string, title: string): LiveItem =>
  ({ id: `douyu:${roomId}`, subscriptionId: "p", kind: "live", title, roomId, url: `https://www.douyu.com/${roomId}`, fetchedAt: 0, isUnread: true, isStarred: false }) as unknown as LiveItem
const cands = candidatesFromSearch([live("288016", "A"), live("288016", "A-dup"), live("999", "B")])
assert(cands.length === 2, "roomId 去重(重复房号只留一条)")
assert(cands[0]!.value === "288016", "候选值 = roomId")
assert(candidatesFromSearch([]).length === 0, "空结果 → 空候选")

// candidatesFromUsers:候选值从 url 提取(raw 不穿 XML 边界),无匹配 url 跳过
const user = (url: string, title: string, summary = ""): MediaItem =>
  ({ id: url, subscriptionId: "p", kind: "video", title, url, summary, fetchedAt: 0, isUnread: true, isStarred: false }) as unknown as MediaItem
const ucands = candidatesFromUsers([
  user("https://space.bilibili.com/37663924", "半佛仙人", "770万粉丝 · 575 个视频"),
  user("https://space.bilibili.com/37663924", "半佛仙人-dup"),
  user("https://www.youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ", "MKBHD", "19.1M subscribers"),
  user("https://www.bilibili.com/video/BV1xx411c7mD", "普通视频不是用户主页"),
])
assert(ucands.length === 2, "url 提取 mid/channelId 去重,非主页 url 跳过")
assert(ucands[0]!.value === "37663924" && ucands[0]!.sub.includes("粉丝"), "bili 候选值 = mid,summary 作次行")
assert(ucands[1]!.value === "UCBJycsmduvYEL83R_U4JriQ", "youtube 候选值 = channelId")
// 用户订阅是单值参数(uid/channelId),无「并入已有」语义 → 不进 MULTI_PARAMS
assert(!MULTI_PARAMS.includes("uid") && !MULTI_PARAMS.includes("channelId"), "uid/channelId 不在列表型参数表")

console.log("\nall checks passed")
