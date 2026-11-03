/**
 * subscriptions.check —— 最小断言(仓库无测试基建,照 core/example/*.check.ts 惯例)。
 * 覆盖 valueList 的分支:列表型参数按逗号切、单值参数**不切**。
 *   bun apps/desktop/src/lib/subscriptions.check.ts
 */

import type { ChannelInfo, LiveItem, MediaItem, Subscription } from "@amoeba/core"

import {
  candidatesFromSearch,
  candidatesFromUsers,
  isManualEntryOnly,
  mergeCandidates,
  mergeValues,
  MULTI_PARAMS,
  multiParamOf,
  searchSources,
  splitValues,
  subsHolding,
  USER_SEARCH_CHANNEL,
  USER_SUB_CHANNEL,
  USER_SUB_PARAM,
  valueList,
} from "./subscriptions.ts"

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
assert(
  JSON.stringify(splitValues("英雄联盟,王者", "keyword")) === JSON.stringify(["英雄联盟,王者"]),
  "splitValues 单值参数不切",
)

// multiParamOf:只有列表型参数能并入
const ch = (key: string, field: string): ChannelInfo =>
  ({
    key,
    name: key,
    kind: "live",
    loginable: false,
    passive: false,
    sourceInfoTpl: [{ key: field, label: field }],
  }) as ChannelInfo
assert(multiParamOf(ch("bili:live", "roomIds")) === true, "roomIds 渠道支持并入")
assert(multiParamOf(ch("bili:anchor", "keyword")) === false, "keyword 渠道不支持并入")

// subsHolding:多值订阅里任一项命中即算已存在
const subs = [sub({ roomIds: "6,21452505" }), { ...sub({ roomIds: "9" }), id: "s2" } as Subscription]
assert(subsHolding(subs, "bili:live", "roomIds", "21452505").length === 1, "并入命中第二条房间号")
assert(subsHolding(subs, "bili:live", "roomIds", "999").length === 0, "未收录的房号不命中")

// mergeValues:保留原顺序,新值去重后追加;重复项不重复加
const merged = mergeValues(["6", "21452505"], ["21452505", "9", "9"])
assert(JSON.stringify(merged.merged) === JSON.stringify(["6", "21452505", "9"]), "并入去重且保留原顺序")
assert(JSON.stringify(merged.added) === JSON.stringify(["9"]), "added 只含本次新增")

// candidatesFromSearch:从接口条目派生候选(roomId 去重、无 roomId 丢弃)
const live = (roomId: string, title: string, handle?: string): LiveItem =>
  ({
    id: `douyu:${roomId}`,
    subscriptionId: "p",
    kind: "live",
    title,
    roomId,
    url: `https://www.douyu.com/${roomId}`,
    ...(handle ? { author: { name: title, handle } } : {}),
    fetchedAt: 0,
    isUnread: true,
    isStarred: false,
  }) as unknown as LiveItem
const cands = candidatesFromSearch([live("288016", "A"), live("288016", "A-dup"), live("999", "B")], "douyu")
assert(cands.length === 2, "roomId 去重(重复房号只留一条)")
assert(cands[0]!.value === "288016", "候选值 = roomId")
assert(candidatesFromSearch([]).length === 0, "空结果 → 空候选")

// candidatesFromUsers:候选值从 url 提取(raw 不穿 XML 边界),无匹配 url 跳过
const user = (url: string, title: string, summary = ""): MediaItem =>
  ({
    id: url,
    subscriptionId: "p",
    kind: "video",
    title,
    url,
    summary,
    fetchedAt: 0,
    isUnread: true,
    isStarred: false,
  }) as unknown as MediaItem
// 每个平台单独调用(平台决定落地目标),合起来仍按平台顺序断言。
const ucands = [
  ...candidatesFromUsers(
    [
      user("https://space.bilibili.com/37663924", "半佛仙人", "770万粉丝 · 575 个视频"),
      user("https://space.bilibili.com/37663924", "半佛仙人-dup"),
      user("https://www.bilibili.com/video/BV1xx411c7mD", "普通视频不是用户主页"),
    ],
    "bili",
  ),
  ...candidatesFromUsers(
    [user("https://www.youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ", "MKBHD", "19.1M subscribers")],
    "youtube",
  ),
  ...candidatesFromUsers([user("https://weibo.com/u/5212695504", "半佛仙人正在装", "207.7万 关注者")], "weibo"),
  ...candidatesFromUsers(
    [user("https://www.douyin.com/user/MS4wLjABAAAAyO-Yizm7OY", "银色虞姬（1号播）", "抖音号 pvcyinse")],
    "douyin",
  ),
  ...candidatesFromUsers(
    [user("https://www.xiaohongshu.com/user/profile/5c6d75a400000000100278fa", "玛卡巴卡")],
    "xhs",
  ),
]
assert(ucands.length === 5, "url 提取各平台用户 id 去重,非主页 url 跳过")
assert(ucands[0]!.value === "37663924" && ucands[0]!.sub.includes("粉丝"), "bili 候选值 = mid,summary 作次行")
assert(ucands[1]!.value === "UCBJycsmduvYEL83R_U4JriQ", "youtube 候选值 = channelId")
assert(ucands[2]!.value === "5212695504", "weibo 候选值 = uid")
assert(ucands[3]!.value.startsWith("MS4wLjAB"), "douyin 候选值 = sec_uid")
assert(ucands[4]!.value === "5c6d75a400000000100278fa", "xhs 候选值 = user_id")

// 带平台时候选自带落地目标(统一搜索跨平台合并后不能按「当前平台」猜)
const bc = candidatesFromUsers([user("https://space.bilibili.com/37663924", "半佛仙人")], "bili")
assert(
  bc[0]!.targets[0]?.kind === "user" &&
    bc[0]!.targets[0]?.channelKey === "bili:user_video" &&
    bc[0]!.targets[0]?.param === "uid",
  "bili 候选落地 bili:user_video/uid",
)
const tc = candidatesFromUsers([user("https://www.twitch.tv/shroud", "shroud")], "twitch")
assert(tc.length === 1 && tc[0]!.value === "shroud", "twitch 候选值 = 频道 login")
assert(
  tc[0]!.targets[0]?.kind === "live" &&
    tc[0]!.targets[0]?.channelKey === "twitch:live" &&
    tc[0]!.targets[0]?.param === "roomIds",
  "twitch 落地 twitch:live/roomIds（没有投稿渠道，目标算直播）",
)

// 主播搜索候选落地直播渠道(roomIds)
const rc = candidatesFromSearch([live("288016", "A")], "douyu")
assert(
  rc[0]!.targets[0]?.channelKey === "live:douyu" && rc[0]!.targets[0]?.param === "roomIds",
  "主播候选落地 live:douyu/roomIds",
)

// 同一个人：主播搜索(roomId + author.handle=uid)与用户搜索(mid)合并成一条、两个目标
const anchor = candidatesFromSearch([live("10139461", "硬核的半佛仙人", "37663924")], "bili")
assert(
  anchor[0]!.targets.length === 2 &&
    anchor[0]!.targets.some((t) => t.kind === "user" && t.value === "37663924") &&
    anchor[0]!.targets.some((t) => t.kind === "live" && t.value === "10139461"),
  "B站主播结果同时给直播间与用户主页目标",
)
const mergedOne = mergeCandidates([
  candidatesFromUsers([user("https://space.bilibili.com/37663924", "半佛仙人", "770万粉丝")], "bili")[0]!,
  anchor[0]!,
])
assert(
  mergedOne.length === 1 && mergedOne[0]!.targets.length === 2 && mergedOne[0]!.label === "半佛仙人",
  "同一人的用户搜索与主播搜索合并为一条候选",
)
// 抖音用户主页可直接作为直播间订阅值(live:douyin 吃主页链接)
const dc = candidatesFromUsers([user("https://www.douyin.com/user/MS4wLjABAAAAyO", "银色虞姬")], "douyin")
assert(
  dc[0]!.targets.some((t) => t.channelKey === "live:douyin" && t.value.endsWith("/user/MS4wLjABAAAAyO")),
  "抖音用户候选同时给直播间目标",
)

// YouTube 直播落地 youtube:live + videoId（不是 roomIds）
const yt = candidatesFromSearch([live("dQw4w9WgXcQ", "YT Live")], "youtube")
assert(
  yt[0]!.targets[0]?.channelKey === "youtube:live" && yt[0]!.targets[0]?.param === "videoId",
  "YouTube 直播候选落地 videoId（与 youtube:live 的参数一致）",
)

// 统一搜索的取数源 = 用户搜索 + 注册表里的 *:anchor;分区/用户主页渠道不再列进目录手填
const infos = [
  ch("bili:user", "keyword"),
  ch("bili:anchor", "keyword"),
  ch("live:douyu:anchor", "keyword"),
  ch("twitch:user:search", "keyword"),
  ch("bili:live:area", "parentAreaId"),
  ch("bili:live", "roomIds"),
]
const srcs = searchSources(infos)
assert(
  JSON.stringify(srcs.map((s) => s.channelKey).sort()) ===
    JSON.stringify(["bili:anchor", "bili:user", "live:douyu:anchor", "twitch:user:search"]),
  "searchSources 覆盖用户搜索与主播搜索",
)
assert(isManualEntryOnly(ch("bili:live:area", "parentAreaId")), "分区渠道不再出现在目录手填")
assert(isManualEntryOnly(ch("live:douyu:anchor", "keyword")), "主播搜索渠道属工具,不进目录")
assert(isManualEntryOnly(ch("bili:live", "roomIds")), "直播间渠道不再出现在目录手填")
assert(isManualEntryOnly(ch("youtube:live", "videoId")), "YouTube 直播不再出现在目录手填（频道直播走统一搜索）")
assert(!isManualEntryOnly(ch("youtube", "videoId")), "YouTube 通用渠道保留手填入口（单视频/频道 ID）")
// 用户订阅是单值参数(uid/channelId/sec_uid/user_id),无「并入已有」语义 → 不进 MULTI_PARAMS
assert(
  !MULTI_PARAMS.includes("uid") && !MULTI_PARAMS.includes("channelId") && !MULTI_PARAMS.includes("sec_uid"),
  "用户订阅参数不在列表型参数表",
)
// 每个用户主页渠道都绑定了搜索渠道与落地参数(缺一项,「搜索添加」面板就不显示该平台)
for (const p of Object.keys(USER_SEARCH_CHANNEL)) {
  assert(!!USER_SUB_CHANNEL[p] && !!USER_SUB_PARAM[p], `${p} 的搜索渠道已绑定落地订阅/参数`)
}

console.log("\nall checks passed")
