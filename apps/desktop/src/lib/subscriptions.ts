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
export function subsHolding(
  subs: Subscription[],
  channelKey: string,
  param: string | undefined,
  value: string,
): Subscription[] {
  return subsOfChannel(subs, channelKey).filter((s) => valueList(s, param).includes(String(value)))
}

/**
 * 一个候选可以落地成的订阅(同一个人可能既有直播间又有主页)。
 * 例如 B站搜主播的结果同时带 roomId 与 uid → 一条候选两种加法。
 */
export interface CandidateTarget {
  kind: "live" | "user"
  channelKey: string
  param: string
  value: string
}

/** 候选项。 */
export interface Candidate {
  /** 主值(与 `targets[0].value` 一致,仅用于展示/兜底)。 */
  value: string
  label: string
  sub: string
  /** 真实封面(条目自带);无则 undefined,由界面用平台标识兜底。 */
  thumb?: string
  /** 元信息标签(在线人数 / 房号 / 分区…)。 */
  meta: string[]
  /** 来源平台(跨平台合并搜索时用于图标 / 去重 / 选中态)。 */
  platform?: string
  /** 可落地的订阅目标;首项 = 默认选择。 */
  targets: CandidateTarget[]
}

/** 落地面向用户的名字(「添加为」)。 */
export const TARGET_LABEL: Record<CandidateTarget["kind"], string> = {
  live: "直播间",
  user: "用户主页",
}

/** 订阅目标的唯一键(同一候选的多个目标、跨候选比较都用它)。 */
export function targetKey(t: CandidateTarget): string {
  return `${t.channelKey}|${t.param}|${t.value}`
}

/**
 * 候选的全局唯一键 = 平台 + 身份。
 * 身份优先用「用户主页」目标的 id(同一人的直播间与主页合并成一条),否则用首个目标。
 */
export function candidateKey(c: Pick<Candidate, "value" | "platform" | "targets">): string {
  const identity = c.targets.find((t) => t.kind === "user") ?? c.targets[0]
  return `${c.platform ?? ""}:${identity?.kind ?? ""}:${identity?.value ?? c.value}`
}

/**
 * 合并来自不同搜索源的候选(同平台同一人只留一条),targets 取并集。
 * 展示信息保留先到的那条 —— 调用方按「用户搜索在前、主播搜索在后」拼输入。
 */
export function mergeCandidates(cands: Candidate[]): Candidate[] {
  const byKey = new Map<string, Candidate>()
  const order: string[] = []
  for (const c of cands) {
    const key = candidateKey(c)
    const prev = byKey.get(key)
    if (!prev) {
      byKey.set(key, { ...c, targets: [...c.targets] })
      order.push(key)
      continue
    }
    for (const t of c.targets) {
      if (!prev.targets.some((x) => targetKey(x) === targetKey(t))) prev.targets.push(t)
    }
    if (!prev.thumb && c.thumb) prev.thumb = c.thumb
    if (!prev.sub && c.sub) prev.sub = c.sub
    for (const m of c.meta) if (!prev.meta.includes(m)) prev.meta.push(m)
  }
  return order.map((k) => byKey.get(k)!)
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

/**
 * 平台 → 直播**订阅渠道**(roomIds 列表型参数)。
 *
 * ⚠️ 2026-11-01 已删除「关键词搜索」渠道（`bili:search` / `live:*:search` /
 * `youtube:live-search`）：只能作为一次性检索用，作为订阅长期产出同一批房间没有价值。
 * 直播间仍可按房号/主页链接订阅（`roomIds`），主播搜索与「搜用户」保留。
 */
export const LIVE_SUB_CHANNEL: Record<string, string> = {
  bili: "bili:live",
  douyu: "live:douyu",
  huya: "live:huya",
  douyin: "live:douyin",
  // 搜索命中的 videoId 直接作为 youtube:live 的订阅参数。
  youtube: "youtube:live",
  twitch: "twitch:live",
}

/**
 * 平台 → 用户**搜索/查号渠道**(输入 → 订阅目标候选)。每个用户主页渠道都绑一个,
 * 「搜索添加」统一从这里取候选(2026-11-01 起覆盖全部用户主页渠道):
 *   - bili / youtube / twitch:按昵称真搜索(匿名);
 *   - weibo:按昵称搜索(**需登录**);
 *   - douyin / xhs:抖音号/用户 ID 查号,**也支持关键词**(被动采集搜索页,需登录)。
 */
export const USER_SEARCH_CHANNEL: Record<string, string> = {
  bili: "bili:user",
  youtube: "youtube:user",
  weibo: "weibo:user:search",
  douyin: "douyin:user:search",
  xhs: "xhs:user:search",
  twitch: "twitch:user:search",
}

/** 平台 → 用户**订阅渠道**(订阅其投稿;参数是单值,非列表 → 无「并入」,
 *  例外:twitch 落地 `twitch:live` 的 roomIds 列表)。 */
export const USER_SUB_CHANNEL: Record<string, string> = {
  bili: "bili:user_video",
  youtube: "youtube",
  weibo: "weibo:user",
  douyin: "douyin:user",
  xhs: "xhs:user",
  twitch: "twitch:live",
}

/**
 * 用户订阅渠道的落地参数名。⚠️ 不从 sourceInfoTpl 首参取 —— `youtube` 渠道首参是
 * videoId(订阅单视频),频道订阅是第二个参数 channelId。
 */
export const USER_SUB_PARAM: Record<string, string> = {
  bili: "uid",
  youtube: "channelId",
  weibo: "uid",
  douyin: "sec_uid",
  xhs: "user_id",
  twitch: "roomIds",
}

/**
 * 手动填 ID 的入口已从「浏览渠道」目录移除的渠道:分区(靠发现页/目录点选)、
 * 用户主页(靠统一搜索)与直播间(靠搜主播/统一搜索)。
 * ⚠️ 这只是**入口收敛**,渠道本身仍可被订阅或预览。
 */
export const NO_MANUAL_ENTRY = new Set<string>([
  ...Object.values(CATEGORY_CHANNEL),
  ...Object.values(USER_SUB_CHANNEL),
  ...Object.values(USER_SEARCH_CHANNEL),
  // 直播间:各平台搜主播 / 统一搜索已覆盖。YouTube 直播参数是 videoId(不是房间号),
  // 且没有搜索入口 → 保留手填,避免功能失去入口。
  ...Object.entries(LIVE_SUB_CHANNEL)
    .filter(([platform]) => platform !== "youtube")
    .map(([, key]) => key),
  // B站分区渠道不在 CATEGORY_CHANNEL(发现页走目录订阅 + 目录条目预览)。
  "bili:live:area",
  // 用户主页动态:uid 只能从 UP 主搜索结果拿到。
  "bili:dynamic",
])

/** 该渠道是否只从「搜索 / 发现页」进入(目录里不再列出)。主播搜索渠道同样按工具处理。 */
export function isManualEntryOnly(channel: ChannelInfo): boolean {
  return channel.key.endsWith(":anchor") || NO_MANUAL_ENTRY.has(channel.key)
}

/** 统一搜索的一个取数源(用户搜索 / 主播搜索)。 */
export interface SearchSource {
  platform: string
  kind: "user" | "room"
  channelKey: string
  /** 该渠道 sourceInfoTpl 的第一个参数名(keyword / roomId / …)。 */
  field: string
}

/**
 * 「输入关键词 → 触发所有可用搜索」的取数源清单。
 *   - 用户搜索:`USER_SEARCH_CHANNEL`(bili / youtube / weibo / douyin / xhs / twitch);
 *   - 主播搜索:注册表里以 `:anchor` 结尾的渠道(bili / douyu / huya)。
 * 只保留 `sourceInfoTpl` 首参存在且为关键词类的渠道(主播渠道首参就是 keyword)。
 */
export function searchSources(channels: ChannelInfo[]): SearchSource[] {
  const out: SearchSource[] = []
  for (const [platform, key] of Object.entries(USER_SEARCH_CHANNEL)) {
    const ch = channels.find((c) => c.key === key)
    const field = ch?.sourceInfoTpl?.[0]?.key
    if (ch && field) out.push({ platform, kind: "user", channelKey: key, field })
  }
  for (const ch of channels) {
    if (!ch.key.endsWith(":anchor")) continue
    const field = ch.sourceInfoTpl?.[0]?.key
    if (!field) continue
    out.push({ platform: platformOf(ch.key), kind: "room", channelKey: ch.key, field })
  }
  return out
}

/** 直播落地点(平台 → 房间列表参数);平台没有直播渠道时无目标。 */
function liveTarget(platform: string, roomValue: string): CandidateTarget | undefined {
  const channelKey = LIVE_SUB_CHANNEL[platform]
  return channelKey ? { kind: "live", channelKey, param: "roomIds", value: roomValue } : undefined
}

/**
 * 用户落地点(平台 → 用户内容渠道)。twitch 落地的是直播频道(roomIds),
 * 目标类型随之算 live —— 它没有「投稿」渠道。
 */
function userTarget(platform: string, value: string): CandidateTarget | undefined {
  const channelKey = USER_SUB_CHANNEL[platform]
  const param = USER_SUB_PARAM[platform]
  if (!channelKey || !param) return undefined
  return { kind: param === "roomIds" ? "live" : "user", channelKey, param, value }
}

/**
 * 用户目标值 → 直播订阅值(有些直播渠道直接吃用户主页链接)。
 * 目前只有抖音:`live:douyin` 的 roomIds 接受主页链接。
 */
const USER_LIVE_VALUE: Record<string, (value: string) => string> = {
  douyin: (secUid) => `https://www.douyin.com/user/${secUid}`,
}

/**
 * 平台搜索渠道返回的条目 → 候选(可选来「订阅某个房间」)。
 * 与 candidatesFor 不同:数据来自**平台搜索接口**(不依赖本机订阅库),故单条直播
 * 也能产出候选。roomId 取 LiveItem.roomId(deserialize 已从 url 推导)。
 * B站 live_user 结果带 `author.handle`(= mid) → 同一条候选也能加「用户主页」。
 */
export function candidatesFromSearch(items: MediaItem[], platform?: string): Candidate[] {
  const out: Candidate[] = []
  const seen = new Set<string>()
  for (const i of items) {
    const live = i as LiveItem
    const roomId = String(live.roomId ?? "").trim()
    if (!roomId || seen.has(roomId)) continue
    seen.add(roomId)
    const targets: CandidateTarget[] = []
    const liveT = platform ? liveTarget(platform, roomId) : undefined
    if (liveT) targets.push(liveT)
    // 主播搜索里的身份(B站 uid)→ 同一个人的主页订阅。
    const handle = String(i.author?.handle ?? "").trim()
    if (platform && handle && USER_SUB_PARAM[platform] === "uid") {
      const userT = userTarget(platform, handle)
      if (userT && !targets.some((t) => targetKey(t) === targetKey(userT))) targets.push(userT)
    }
    if (!targets.length) continue
    const online = live.online ? `${fmtNum(live.online)} 在看` : ""
    // YouTube 没有「房号」概念,直播的 roomId 就是 videoId。
    const idLabel = live.platform === "youtube" ? "视频" : "房号"
    // 主播名与标题常常相同(个人直播间),别在次行重复一遍。
    const author = String(i.author?.name ?? "").trim()
    const sub = [author && author !== i.title ? author : "", `${idLabel} ${roomId}`].filter(Boolean).join(" · ")
    out.push({
      value: roomId,
      label: i.title,
      sub,
      thumb: mediaUrl(i),
      meta: [online].filter(Boolean),
      ...(platform ? { platform } : {}),
      targets,
    })
  }
  return out
}

/**
 * 用户搜索渠道返回的条目 → 候选(搜/查用户 → 订阅其投稿)。
 * value 从 **url 解析**(raw 不穿 XML 边界,serialize 不写,所以只能从 url 取):
 *   `space.bilibili.com/<mid>` / `youtube.com/channel/<channelId>` /
 *   `weibo.com/u/<uid>` / `douyin.com/user/<sec_uid>` /
 *   `xiaohongshu.com/user_profile/<user_id>` / `twitch.tv/<login>`。
 * 次行信息(粉丝/订阅数)来自条目 summary(channel 侧已拼好)。
 * 抖音额外给一个「直播间」目标(live:douyin 的 roomIds 接受主页链接)。
 */
export function candidatesFromUsers(items: MediaItem[], platform?: string): Candidate[] {
  const out: Candidate[] = []
  const seen = new Set<string>()
  const USER_URL = [
    /space\.bilibili\.com\/(\d+)/,
    /youtube\.com\/channel\/(UC[\w-]+)/,
    /weibo\.com\/u\/(\d+)/,
    /douyin\.com\/user\/(MS4wLjAB[\w-]+)/,
    /xiaohongshu\.com\/user(?:_|\/)profile\/([0-9a-f]{16,32})/i,
    // 排除 Twitch 一级路由此类站内页(它们单段且不是频道名)。
    /twitch\.tv\/(?!directory|videos|search|settings|login|subscriptions|wallet|drops|jobs|downloads|turbo)([a-z0-9_]{3,25})\/?$/i,
  ]
  for (const i of items) {
    const url = String(i.url ?? "")
    const m = USER_URL.map((re) => re.exec(url)).find(Boolean)
    if (!m) continue
    const value = m[1]!
    if (seen.has(value)) continue
    seen.add(value)
    const targets: CandidateTarget[] = []
    const userT = platform ? userTarget(platform, value) : undefined
    if (userT) targets.push(userT)
    const toLive = platform ? USER_LIVE_VALUE[platform] : undefined
    const liveT = platform && toLive ? liveTarget(platform, toLive(value)) : undefined
    if (liveT && !targets.some((t) => targetKey(t) === targetKey(liveT))) targets.push(liveT)
    if (!targets.length) continue
    out.push({
      value,
      label: i.title,
      sub: i.summary ?? "",
      thumb: mediaUrl(i),
      meta: [],
      ...(platform ? { platform } : {}),
      targets,
    })
  }
  return out
}

/* ⚠️ 已删除 candidatesFor / candidateHay:它们从**本机订阅库**派生候选(「搜索」变成
 * 在已抓到的数据里筛)。候选接口统一走 `dl.previewChannel(channelKey, info)`:
 * 搜用户用 `USER_SEARCH_CHANNEL` / `candidatesFromUsers`,搜主播用 `*:anchor`。 */
