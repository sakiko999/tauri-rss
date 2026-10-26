/**
 * subscriptions —— 订阅参数的读写与「添加订阅」候选派生(纯函数,不依赖 store)。
 *
 * 候选值一律取自本机订阅库里已抓到的真实条目,派生不出就返回空数组由界面降级为手填
 * ——绝不编造 uid / 房号。
 */
import type { ChannelInfo, LiveItem, MediaItem, Subscription } from "@amoeba/core"
import { platformOfChannelKey } from "@amoeba/platform"
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
export function splitValues(raw: string | undefined, param: string | undefined): string[] {
  if (!param) return []
  const s = String(raw ?? "").trim()
  if (!s) return []
  if (!MULTI_PARAMS.includes(param)) return [s]
  return s
    .split(/[,，\s]+/)
    .map((v) => v.trim())
    .filter(Boolean)
}

export function valueList(sub: Subscription | undefined, param: string | undefined): string[] {
  if (!param) return []
  return splitValues(String(sub?.info?.[param] ?? ""), param)
}

/** 把本次输入并入已有列表：保留原顺序，新值去重后追加。 */
export function mergeValues(held: string[], incoming: string[]): { merged: string[]; added: string[] } {
  const added = [...new Set(incoming)].filter((v) => !held.includes(v))
  return { merged: [...held, ...added], added }
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

/**
 * 渠道 key 前缀 → 平台 id（`live:douyu` 归 douyu）。
 * 已登记的走 `@amoeba/platform`（与 governor / core 同源）；未登记的（rss: 直链等）
 * 退回取第一段，保持 UI 分组不崩。
 */
export function platformOf(key: string): string {
  return platformOfChannelKey(key) ?? key.split(":")[0] ?? key
}

/**
 * 平台 → 直播**搜索渠道**(搜房间关键词 → 房间候选)。
 * 键 = `platformOf(订阅渠道 key)`;值 = 该平台的 search channel key。
 * ⚠️ 只登记**匿名可用**的 search 渠道(实测):
 *   - douyin search 本质是**分区搜索**（关键词→分区→列房，不搜主播/房间标题）；
 *     登记后搜索面板的输入框会明确写「分区关键词」，结果仍是可订阅的直播间
 *   - huya search 不可分页但首页可用 → 登记
 */
export const SEARCH_CHANNEL: Record<string, string> = {
  bili: "bili:search",
  douyu: "live:douyu:search",
  huya: "live:huya:search",
  douyin: "live:douyin:search",
  youtube: "youtube:live-search",
}

/**
 * 平台 → 分区**订阅渠道**（已知分区 ID 直接取内容）。
 * ⚠️ 这只是「手输分区 → 取内容」的入口；分区**目录**（分类列表本身）是独立订阅，
 * 见 `*:categories` 渠道（`twitch:categories` / `youtube:live-categories` / …）。
 * 分区渠道名不统一（`youtube:live-category`），故用显式表，不按命名约定猜。
 */
export const CATEGORY_CHANNEL: Record<string, string> = {
  douyu: "live:douyu:category",
  huya: "live:huya:category",
  douyin: "live:douyin:category",
  twitch: "twitch:category",
  youtube: "youtube:live-category",
}

/** 平台 → 直播**订阅渠道**(roomIds 列表型参数)。 */
export const LIVE_SUB_CHANNEL: Record<string, string> = {
  bili: "bili:live",
  douyu: "live:douyu",
  huya: "live:huya",
  douyin: "live:douyin",
  // 搜索命中的 videoId 直接作为 youtube:live 的订阅参数。
  youtube: "youtube:live",
  // 一期只做订阅(搜索/分区二期;故 SEARCH_CHANNEL 不登记)。
  twitch: "twitch:live",
}

/** 平台 → 用户**搜索渠道**(搜 UP主/频道名 → 订阅目标候选;同 SEARCH_CHANNEL 的用户版)。 */
export const USER_SEARCH_CHANNEL: Record<string, string> = {
  bili: "bili:user",
  youtube: "youtube:user",
}

/** 平台 → 用户**订阅渠道**(订阅其投稿;参数是单值 uid/channelId,非列表 → 无「并入」)。 */
export const USER_SUB_CHANNEL: Record<string, string> = {
  bili: "bili:user_video",
  youtube: "youtube",
}

/**
 * 用户订阅渠道的落地参数名。⚠️ 不从 sourceInfoTpl 首参取 —— `youtube` 渠道首参是
 * videoId(订阅单视频),频道订阅是第二个参数 channelId。
 */
export const USER_SUB_PARAM: Record<string, string> = {
  bili: "uid",
  youtube: "channelId",
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
    // YouTube 没有「房号」概念,直播的 roomId 就是 videoId。
    const idLabel = live.platform === "youtube" ? "视频" : "房号"
    out.push({
      value: roomId,
      label: i.title,
      sub: `${i.author?.name ?? "未知"} · ${idLabel} ${roomId}`,
      thumb: mediaUrl(i),
      meta: [online].filter(Boolean),
    })
  }
  return out
}

/**
 * 用户搜索渠道返回的条目 → 候选(搜 UP主/频道 → 订阅其投稿)。
 * value 从 **url 解析**(raw 不穿 XML 边界,serialize 不写,所以只能从 url 取):
 * `space.bilibili.com/<mid>` / `youtube.com/channel/<channelId>`。
 * 次行信息(粉丝/订阅数)来自条目 summary(channel 侧已拼好)。
 */
export function candidatesFromUsers(items: MediaItem[]): Candidate[] {
  const out: Candidate[] = []
  const seen = new Set<string>()
  for (const i of items) {
    const url = String(i.url ?? "")
    const m = /space\.bilibili\.com\/(\d+)/.exec(url) ?? /youtube\.com\/channel\/(UC[\w-]+)/.exec(url)
    if (!m) continue
    const value = m[1]!
    if (seen.has(value)) continue
    seen.add(value)
    out.push({
      value,
      label: i.title,
      sub: i.summary ?? "",
      thumb: mediaUrl(i),
      meta: [],
    })
  }
  return out
}

/* ⚠️ 已删除 candidatesFor / candidateHay:它们从**本机订阅库**派生候选(「搜索」变成
 * 在已抓到的数据里筛),而平台的真实搜索接口(live:*:search / bili:search)一直可用却
 * 没被用上。改为 AddSubscriptionDialog 调 `dl.previewChannel(searchChannel, {keyword})`
 * 走接口取候选(见 SEARCH_CHANNEL / candidatesFromSearch)。 */
