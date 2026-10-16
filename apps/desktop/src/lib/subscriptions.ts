/**
 * subscriptions —— 订阅参数的读写与「添加订阅」候选派生(纯函数,不依赖 store)。
 *
 * 候选值一律取自本机订阅库里已抓到的真实条目,派生不出就返回空数组由界面降级为手填
 * ——绝不编造 uid / 房号。
 */
import type { ChannelInfo, LiveItem, MediaItem, Subscription } from "@amoeba/core"
import { mediaUrl } from "./media.ts"

/** 逗号分隔、可把候选**并入**已有订阅的列表型参数(直播房间号)。 */
export const MULTI_PARAMS = ["roomIds"]

/** 该渠道的首个参数是否支持并入已有订阅(只有列表型参数能「加进去」)。 */
export function multiParamOf(channel: ChannelInfo | undefined): boolean {
  const f = channel?.sourceInfoTpl?.[0]
  return !!f && MULTI_PARAMS.includes(f.key)
}

/**
 * 取出某条订阅某参数的值列表。
 * ⚠️ 只有列表型参数按逗号切分 —— 关键词之类的单值参数本身就可能含逗号
 * (「英雄联盟,王者」),切了会把一条订阅误判成「两个目标都已订阅」。
 */
export function valueList(sub: Subscription | undefined, param: string | undefined): string[] {
  if (!param) return []
  const raw = String(sub?.info?.[param] ?? "").trim()
  if (!raw) return []
  if (!MULTI_PARAMS.includes(param)) return [raw]
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
}

/** 该渠道下已存在的订阅(搜索添加的「添加到」候选)。 */
export function subsOfChannel(subs: Subscription[], channelKey: string): Subscription[] {
  return subs.filter((s) => s.channelKey === channelKey)
}

/** 该渠道下哪些订阅已经含有这个值 —— 可能不止一条(重复订阅过)。 */
export function subsHolding(subs: Subscription[], channelKey: string, param: string | undefined, value: string): Subscription[] {
  return subsOfChannel(subs, channelKey).filter((s) => valueList(s, param).includes(String(value)))
}

/** 候选项。 */
export interface Candidate {
  value: string
  label: string
  sub: string
  /** 真实封面(条目自带);无则 undefined,由界面用平台标识兜底。 */
  thumb?: string
  /** 元信息标签(在线人数 / 房号 / 分区…)。 */
  meta: string[]
}

/** 数字缩写:1.2万 / 3.4亿。 */
function fmtNum(n?: number): string {
  const v = Number(n) || 0
  if (v >= 1e8) return `${(v / 1e8).toFixed(1).replace(/\.0$/, "")}亿`
  if (v >= 1e4) return `${(v / 1e4).toFixed(1).replace(/\.0$/, "")}万`
  return String(v)
}

/** 渠道 key 前缀 → 平台 id(`live:douyu` 归 douyu)。 */
export function platformOf(key: string): string {
  const parts = key.split(":")
  return parts[0] === "live" && parts[1] ? parts[1] : parts[0] ?? key
}

/**
 * 平台 → 直播**搜索渠道**(搜房间关键词 → 房间候选)。
 * 键 = `platformOf(订阅渠道 key)`;值 = 该平台的 search channel key。
 * ⚠️ 只登记**匿名可用**的 search 渠道(实测):
 *   - douyin search 仅 `partition/search` 且只认游戏名级(见 docs/capability-gaps.md)→ 不登记
 *   - huya search 不可分页但首页可用 → 登记
 */
export const SEARCH_CHANNEL: Record<string, string> = {
  bili: "bili:search",
  douyu: "live:douyu:search",
  huya: "live:huya:search",
}

/** 平台 → 直播**订阅渠道**(roomIds 列表型参数)。 */
export const LIVE_SUB_CHANNEL: Record<string, string> = {
  bili: "bili:live",
  douyu: "live:douyu",
  huya: "live:huya",
  douyin: "live:douyin",
}

/** 某平台的搜索渠道 key(无则 undefined → UI 降级手填)。 */
export function searchChannelOf(platform: string): string | undefined {
  return SEARCH_CHANNEL[platform]
}

/**
 * 平台搜索渠道返回的条目 → 候选(可选来「订阅某个房间」)。
 * 与 candidatesFor 不同:数据来自**平台搜索接口**(不依赖本机订阅库),故单条直播
 * 也能产出候选。roomId 取 LiveItem.roomId(deserialize 已从 url 推导)。
 */
export function candidatesFromSearch(items: MediaItem[]): Candidate[] {
  const out: Candidate[] = []
  const seen = new Set<string>()
  for (const i of items) {
    const live = i as LiveItem
    const roomId = String(live.roomId ?? "").trim()
    if (!roomId || seen.has(roomId)) continue
    seen.add(roomId)
    const online = live.online ? `${fmtNum(live.online)} 在看` : ""
    out.push({
      value: roomId,
      label: i.title,
      sub: `${i.author?.name ?? "未知"} · 房号 ${roomId}`,
      thumb: mediaUrl(i),
      meta: [online].filter(Boolean),
    })
  }
  return out
}

/* ⚠️ 已删除 candidatesFor / candidateHay:它们从**本机订阅库**派生候选(「搜索」变成
 * 在已抓到的数据里筛),而平台的真实搜索接口(live:*:search / bili:search)一直可用却
 * 没被用上。改为 AddSubscriptionDialog 调 `dl.previewChannel(searchChannel, {keyword})`
 * 走接口取候选(见 SEARCH_CHANNEL / candidatesFromSearch)。 */
