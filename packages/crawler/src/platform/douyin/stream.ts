/**
 * douyin 流解析 —— enter → reflow → HTML 三级降级拉直播直链。
 *
 * 从 channel 下沉(对齐 douyuResolveStreams / huya play.ts):channel 只留一行委托。
 * 三级降级:
 *   1. enter API 的 stream_url(live_core_sdk_data + flv_pull_url,2026-08-08 实测
 *      web_rid 查询直接返回全画质直链)——主路径;
 *   2. reflow/info 端点(room_id 长号,stream_url 兜底);
 *   3. 抓网页 HTML 提取 flv_pull_url(dart_simple_live 同款兜底)。
 * ⚠️ roomId 参数是订阅的 **web_rid(短号)**,不是 enter 返回的 room_id/id_str(长号)。
 * 每次 resolve 独立取新鲜签名直链(带过期时间)。
 */
import * as R from "ramda"
import type { Stream } from "@tauri-playground/xml"
import { httpJson, httpText } from "../../host.ts"
import { log } from "../../log.ts"
import { parseJsonSafe } from "../../utils/inline-json.ts"
import { toInt } from "../../utils/number.ts"
import { UA_ENTER } from "./abogus.ts"
import { douyinCookie, fetchRoom } from "./client.ts"

const LIVE = "https://live.douyin.com"
/** 模块内 UA 别名(enter/热门 QQBrowser UA,见 abogus.ts UA_ENTER)。 */
const UA = UA_ENTER

/** douyin 流解析主入口:三级降级,返回可播流数组(契约:最高清晰度排最前)。 */
export async function douyinResolveStreams(roomId: string): Promise<Stream[]> {
  // 1. enter API(主路径)
  try {
    const room = await fetchRoom(roomId)
    const streams = parseDouyinStreams((room.stream_url ?? {}) as Record<string, any>)
    if (streams.length) return streams
  } catch (e) {
    log.douyin.warn("enter API 失败:", (e as Error)?.message)
  }
  // 2. reflow/info(room 长号)
  try {
    const streams = await fetchReflowStreams(roomId)
    if (streams.length) return streams
  } catch (e) {
    log.douyin.warn("reflow API 失败,降级 HTML:", (e as Error)?.message)
  }
  // 3. HTML 兜底
  return resolveFromHtml(roomId)
}

/**
 * reflow/info 端点:先 enter 拿 room 长号(id_str),再 `webcast/room/reflow/info` 拿
 * stream_url。返回的 flv_pull_url.{FULL_HD1/HD1/SD1/SD2} 是带签名直链,
 * 键名即清晰度降序——按序取即最高画质优先。
 */
async function fetchReflowStreams(roomId: string): Promise<Stream[]> {
  // 拿 room 长号(enter API 仍返回 id_str,只是不返回 stream_url)
  const res = await fetchRoom(roomId)
  const room = (res?.data?.data?.[0] ?? res?.data?.room ?? {}) as Record<string, any>
  const longId = String(room.id_str ?? room.id ?? "")
  if (!longId) throw new Error("douyin reflow: 无 room 长号")

  // reflow headers 复刻 dart _getRoomDataByRoomId(douyin_site.dart:522)——用默认 headers
  // (Authority: live.douyin.com),不设 webcast.amemv.com authority。
  const body = await httpJson<Record<string, any>>(
    `https://webcast.amemv.com/webcast/room/reflow/info/?type_id=0&live_id=1&room_id=${longId}&sec_user_id=&version_code=99.99.99&app_id=6383`,
    {
      "user-agent": UA,
      referer: LIVE,
      authority: "live.douyin.com",
      cookie: await douyinCookie(),
    },
  )
  const detail = ((body ?? {}).data?.room ?? (body ?? {}).data ?? {}) as Record<string, any>
  return parseReflowStreams((detail.stream_url ?? {}) as Record<string, any>)
}

/**
 * HTML 兜底:抓 `live.douyin.com/{roomId}` 页面,正则提取 flv_pull_url 直链。
 * 页面里 stream_url.flv_pull_url.{FULL_HD1/HD1/...} 是带签名的 flv 直链,
 * 需实时抓取(签名有过期时间)。参照 dart_simple_live 的 _getRoomDataByHtml
 * (douyin_site.dart:451)——动态 Referer(含房间号),cookie 用 warmup 或默认 ttwid。
 */
async function resolveFromHtml(roomId: string): Promise<Stream[]> {
  const html = await httpText(`${LIVE}/${roomId}`, {
    "user-agent": UA,
    referer: `${LIVE}/${roomId}`,
    authority: "live.douyin.com",
    cookie: await douyinCookie(),
  })
  const streams = parseHtmlPullStreams(html)
  if (!streams.length) throw new Error(`douyin HTML: 未找到可播流(房间 ${roomId} 可能未开播)`)
  return streams
}

/** 过滤 IPv6 host 的直链(WebView 请求 IPv6 CDN 常 404;优先 IPv4/域名)。 */
function filterPlayable(streams: Stream[]): Stream[] {
  return streams.filter((s) => !/\[[0-9a-f:]+\]/.test(s.url))
}

/**
 * 从抖音 enter 响应的 stream_url 提取各清晰度可播流(函数式)。
 * 复刻 dart getPlayQualites(douyin_site.dart:538):
 *   1. stream_data 是 JSON → 按 sdk_key 展开 data[key].main.{flv,hls};
 *   2. stream_data 非 JSON → 用 flv_pull_url / hls_pull_url_map 按 level 索引兜底。
 * 按清晰度从高到低返回;每档 flv 优先(flv 体积小加载快),hls 兜底。
 */
function parseDouyinStreams(streamUrl: Record<string, any>): Stream[] {
  const pullData = R.pathOr<Record<string, any>>({}, ["live_core_sdk_data", "pull_data"], streamUrl)
  const qualities = R.pathOr<Record<string, any>[]>([], ["options", "qualities"], pullData)
  const headers = { referer: LIVE, "user-agent": UA }
  // level 降序(dart: qualities 按 level 从高到低;手写 sort 语义等价 R.sortWith descend)。
  const sorted = R.sortWith([R.descend((q: Record<string, any>) => toInt(q?.level) ?? 0)], qualities)
  // stream_data 可能缺失或非 JSON → 走 flv_pull_url 兜底。
  const streamData = parseJsonSafe(String(pullData?.stream_data ?? "").trimStart().startsWith("{") ? String(pullData?.stream_data) : "")

  // 每档 quality → 一条 Stream(flv 优先,hls 兜底)。两条来源路径产出同一 shape:
  //   主路径:data[sdk_key].main.{flv,hls}(运行时动态键,sdk_key 来自 quality);
  //   兜底:flv_pull_url / hls_pull_url_map 按 level 索引。
  const toStreams = streamData
    ? (q: Record<string, any>): Stream[] => {
        const main = R.pathOr<Record<string, any>>({}, ["data", String(q?.sdk_key ?? ""), "main"], streamData)
        const name = String(q?.name ?? "") || String(q?.sdk_key ?? "")
        const level = toInt(q?.level) ?? 0
        const flv = String(main?.flv ?? "")
        const hls = String(main?.hls ?? "")
        if (flv) return [{ url: flv, format: "flv", headers: { ...headers, authority: LIVE }, quality: name, rate: level }]
        if (hls) return [{ url: hls, format: "hls", headers, quality: name, rate: level }]
        return []
      }
    : (q: Record<string, any>): Stream[] => {
        const flvList = Object.values(R.pathOr<Record<string, string>>({}, ["flv_pull_url"], streamUrl))
        const hlsList = Object.values(R.pathOr<Record<string, string>>({}, ["hls_pull_url_map"], streamUrl))
        const level = toInt(q?.level) ?? 0
        const name = String(q?.name ?? "") || String(q?.sdk_key ?? "")
        const flv = flvList[flvList.length - level] ?? ""
        const hls = hlsList[hlsList.length - level] ?? ""
        if (flv) return [{ url: flv, format: "flv", headers, quality: name, rate: level }]
        if (hls) return [{ url: hls, format: "hls", headers, quality: name, rate: level }]
        return []
      }

  return filterPlayable(R.chain(toStreams, sorted))
}

/**
 * 从 douyin 网页 HTML 提取 flv_pull_url 直链(HTML fallback)。
 * 页面里 `"stream_url":{"flv_pull_url":{"FULL_HD1":"http...","HD1":"..."}}`
 * 是带签名的 flv 直链(转义 `&` = `&`)。实时抓取,签名有过期时间。
 * 按清晰度键名顺序返回(蓝光/高清优先)。
 */
function parseHtmlPullStreams(html: string): Stream[] {
  const headers = { referer: LIVE, "user-agent": UA, authority: "live.douyin.com" }
  const streams: Stream[] = []
  // 只取 flv_pull_url 对象(到下一个 _pull_url 或片段结束);hls_pull_url 是 m3u8,另论。
  const flvStart = html.indexOf("flv_pull_url")
  if (flvStart < 0) return streams
  // 下一个 _pull_url(hls_pull_url);注意跳过 flv_pull_url 自身的 `_pull_url` 子串。
  const flvEnd = html.indexOf("_pull_url", flvStart + "flv_pull_url".length)
  const seg = html.slice(flvStart, flvEnd > flvStart ? flvEnd : flvStart + 3000)
  // 逐清晰度用 indexOf 提取(避免正则转义坑):`"KEY":"http...`。
  const found = new Map<string, string>()
  for (const q of QUALITY_ORDER) {
    const ki = seg.indexOf(`\\"${q}\\":\\"`)
    if (ki < 0) continue
    // http/https 都认(douyin 直链两种前缀都出现;只认 http: 会在 https 直链时漏掉)。
    let urlStart = seg.indexOf("http:", ki)
    if (urlStart < 0) urlStart = seg.indexOf("https:", ki)
    if (urlStart < 0) continue
    // URL 到未转义的引号结束(页面里转义引号是 `\"`,URL 参数里 `&` 是转义的 &)。
    let url = ""
    for (let i = urlStart; i < seg.length; i++) {
      const c = seg[i]
      if (c === "\\" && seg[i + 1] === '"') break // 未转义边界:转义引号
      url += c
    }
    if (url) found.set(q, url)
  }
  for (const [idx, q] of QUALITY_ORDER.entries()) {
    const url = found.get(q)
    if (url) {
      streams.push({
        url: url.replaceAll("\\u0026", "&"),
        format: "flv",
        headers,
        quality: DOUYIN_QUALITY_NAMES[q] ?? q,
        rate: QUALITY_ORDER.length - idx,
      })
    }
  }
  return filterPlayable(streams)
}

/** 抖音清晰度键名(键序即清晰度降序;HTML/reflow 解析共用)。 */
const QUALITY_ORDER = ["FULL_HD1", "HD1", "SD1", "SD2", "ORIGION"]
const DOUYIN_QUALITY_NAMES: Record<string, string> = {
  FULL_HD1: "蓝光",
  HD1: "高清",
  SD1: "标清",
  SD2: "流畅",
  ORIGION: "原画",
}

/**
 * 从 reflow/info API 的 stream_url 提取 flv_pull_url 直链(reflow 主路径)。
 * reflow 返回 `flv_pull_url: {"FULL_HD1": "http...", "HD1": "...", ...}` 对象,
 * 键名即清晰度降序(FULL_HD1 最高)。hls_pull_url 是 m3u8,flv 优先返回。
 * 参照 dart_simple_live 的 flv_pull_url 解析(douyin_site.dart:564)。
 * 每档挂 quality 名 + rate(键名顺序倒序,高档 rate 大),供 MediaPlayer 画质切换。
 */
function parseReflowStreams(streamUrl: Record<string, any>): Stream[] {
  const headers = { referer: LIVE, "user-agent": UA, authority: "live.douyin.com" }
  const streams: Stream[] = []

  const flvPull = (streamUrl?.flv_pull_url ?? {}) as Record<string, string>
  const hlsPull = (streamUrl?.hls_pull_url ?? {}) as Record<string, string>
  // 按清晰度键名顺序返回(蓝光/高清优先);每档 flv 优先,hls 兜底。rate = 档位序号(高→低)。
  for (const [idx, q] of QUALITY_ORDER.entries()) {
    const flv = String(flvPull[q] ?? "")
    if (flv) {
      streams.push({
        url: flv.replaceAll("\\u0026", "&"),
        format: "flv",
        headers,
        quality: DOUYIN_QUALITY_NAMES[q] ?? q,
        rate: QUALITY_ORDER.length - idx,
      })
      continue
    }
    const hls = String(hlsPull[q] ?? "")
    if (hls) {
      streams.push({
        url: hls.replaceAll("\\u0026", "&"),
        format: "hls",
        headers,
        quality: DOUYIN_QUALITY_NAMES[q] ?? q,
        rate: QUALITY_ORDER.length - idx,
      })
    }
  }
  return filterPlayable(streams)
}
