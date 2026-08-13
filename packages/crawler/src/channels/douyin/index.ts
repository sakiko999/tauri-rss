/**
 * douyin 直播房间 channel —— HTTP + ABogus 签名(host.js)。
 *
 * 复刻 producer 的 DouyinSite:对 `live.douyin.com/webcast/...` 请求用 host.js
 * 执行 ABOGUS_JS 里的 `getABogus(query, UA)` 生成 a_bogus 参数;ttwid cookie 由
 * 首页 warmup 抓取(memoized)。
 *
 * 产 Live Item(状态 + 元数据);resolveLivePlay 懒解析时重新走 enter/reflow/HTML
 * 三链(每次独立取新鲜签名直链,带过期时间)。liveStatus 判定:**status==2 才是直播中**
 * (复刻 dart,实测在播房间返回 2);status==4 是 roomId 一次性、需改用 webRid,非直播中。
 */
import * as R from "ramda"
import type { Item, Live, Stream } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { DanmakuPlayable, LivePlayable, RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch } from "../factory.ts"
import { httpJson, httpText, now } from "../../host.ts"
import { log } from "../../log.ts"
import { parseJsonSafe } from "../../utils/inline-json.ts"
import { toInt } from "../../utils/number.ts"
import { parseRoomIds } from "../../utils/room-ids.ts"
import { DEFAULT_TTWID, UA_ENTER, enterRoomParams, signDouyinUrl } from "./abogus.ts"
import { deferredStream } from "../../danmaku/deferred.ts"
import { strOr } from "../../utils/str.ts"
import { douyinDanmakuStream } from "./danmaku.ts"


const LIVE = "https://live.douyin.com"
/** 模块内 UA 别名(enter/热门 QQBrowser UA,见 abogus.ts UA_ENTER)。 */
const UA = UA_ENTER

export class DouyinLiveChannel implements RssChannel {
  readonly key = "live:douyin"
  readonly name = "抖音直播房间"
  readonly kind = "live" as const
  readonly sourceInfoTpl = [{ key: "roomIds", label: "直播间 ID(逗号分隔,可多个)", required: true }]
  // 直播源:implements LivePlayable + DanmakuPlayable。resolveLivePlay 闭包捕获 this 实例状态(ABogus 签名 + cookie jar)。
  // fetch 支持多房间(roomIds 逗号分隔);resolveLivePlay/getDanmaku 本就是按 roomId 工作,天然支持任一房间。
  getSource(info: SourceInfo): RssSource & LivePlayable & DanmakuPlayable {
    return {
      fetch: apiFetch(() => this.fetchItems(info), () => this.channelOptions(info)),
      resolveLivePlay: (roomId) => this.resolveLivePlayImpl(roomId),
      // 弹幕:先 ensureCookie(warmup 抓新鲜 ttwid)再建连——douyin 握手需带
      // cookie(缺则 415 DEVICE_BLOCKED)。deferredStream 统一「异步 setup 期间
      // 退订 → 拦截建连」,防 warmup 完成时已关闭直播间仍建 WS 泄漏。
      getDanmaku: (roomId) =>
        deferredStream(
          () => this.ensureCookie(),
          (_value, onItems) => douyinDanmakuStream(roomId, this.cookieJar)(onItems),
          (e) => log.douyin.warn("弹幕初始化失败:", (e as Error)?.message),
        ),
    }
  }

  /** 懒初始化的 cookie jar(warmup GET 抓到的新鲜 ttwid 等)。 */
  private cookieJar = ""
  private cookiePromise: Promise<void> | null = null

  /**
   * 懒解析直播流,多级降级:
   *   1. enter API 的 stream_url(live_core_sdk_data + flv_pull_url,2026-08-08 实测
   *      web_rid 查询直接返回全画质直链)——主路径;
   *   2. reflow/info 端点(room_id 长号,stream_url 兜底);
   *   3. 抓网页 HTML 提取 flv_pull_url(dart_simple_live 同款兜底)。
   * ⚠️ roomId 参数是订阅的 **web_rid(短号)**,不是 enter 返回的 room_id/id_str(长号)。
   */
  private async resolveLivePlayImpl(roomId: string): Promise<Stream[]> {
    // 1. enter API
    try {
      const res = await this.fetchRoomDetail(roomId)
      const room = (res?.data?.data?.[0] ?? res?.data?.room ?? {}) as Record<string, any>
      const streams = parseDouyinStreams((room.stream_url ?? {}) as Record<string, any>)
      if (streams.length) return streams
    } catch (e) {
      log.douyin.warn("enter API 失败:", (e as Error)?.message)
    }
    // 2. reflow/info(room 长号)
    try {
      const streams = await this.fetchReflowStreams(roomId)
      if (streams.length) return streams
    } catch (e) {
      log.douyin.warn("reflow API 失败,降级 HTML:", (e as Error)?.message)
    }
    // 3. HTML 兜底
    return this.resolveFromHtml(roomId)
  }

  /**
   * reflow/info 端点:先 enter 拿 room 长号(id_str),再 `webcast/room/reflow/info` 拿
   * stream_url。返回的 flv_pull_url.{FULL_HD1/HD1/SD1/SD2} 是带签名直链,
   * 键名即清晰度降序——按序取即最高画质优先。
   */
  private async fetchReflowStreams(roomId: string): Promise<Stream[]> {
    // 拿 room 长号(enter API 仍返回 id_str,只是不返回 stream_url)
    const res = await this.fetchRoomDetail(roomId)
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
        cookie: this.cookieJar || DEFAULT_TTWID,
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
  private async resolveFromHtml(roomId: string): Promise<Stream[]> {
    const html = await httpText(`${LIVE}/${roomId}`, {
      "user-agent": UA,
      referer: `${LIVE}/${roomId}`,
      authority: "live.douyin.com",
      cookie: this.cookieJar || DEFAULT_TTWID,
    })
    const streams = parseHtmlPullStreams(html)
    if (!streams.length) throw new Error(`douyin HTML: 未找到可播流(房间 ${roomId} 可能未开播)`)
    return streams
  }

  private async fetchItems(info: SourceInfo): Promise<Item[]> {
    const roomIds = parseRoomIds(info)
    if (!roomIds.length) throw new Error("live:douyin 需要 roomIds")
    const t = now()
    const rooms = await Promise.all(
      roomIds.map((roomId) =>
        this.fetchOne(roomId).catch((e) => {
          log.douyin.warn(`房间 ${roomId} 拉取失败,跳过:`, (e as Error)?.message)
          return null
        }),
      ),
    )
    return rooms.filter((r): r is Live => r !== null).map((live) => ({ ...live, fetchedAt: t }))
  }

  /** 单房间 → Live item(enter API;房间失败抛错,由调用方 catch 隔离)。 */
  private async fetchOne(roomId: string): Promise<Live> {
    const res = await this.fetchRoomDetail(roomId)
    const room = (res?.data?.data?.[0] ?? res?.data?.room ?? {}) as Record<string, any>
    const user = (res?.data?.data?.[0]?.user ?? res?.data?.user ?? {}) as Record<string, any>
    const streamUrl = (room.stream_url ?? {}) as Record<string, any>
    // douyin room.status 语义:2=直播中(复刻 dart,实测 217952067344 在播时 status=2)。
    // 4=roomId 一次性(需改用 webRid,见 dart getRoomDetailByRoomId),非直播中。
    const isLive = toInt(room.status) === 2

    return {
      // id 用长号 id_str(唯一稳定);roomId 必须用订阅传入的 web_rid(短号)——
      // douyin 的 enter API / HTML 页面 / resolveLivePlay 都用 web_rid,不是 room_id。
      id: `douyin:${String(room.id_str ?? roomId)}`,
      sourceId: "live:douyin",
      kind: "live",
      title: String(room.title ?? ""),
      url: `${LIVE}/${roomId}`,
      thumbnail: String(streamUrl?.default?.push_hd?.main?.[0]?.flv ?? room?.cover?.url_list?.[0] ?? ""),
      author: { name: String(user.nickname ?? ""), avatar: String(user?.avatar_thumb?.url_list?.[0] ?? "") || undefined },
      fetchedAt: now(),
      platform: "douyin",
      roomId: String(roomId),
      liveStatus: isLive ? "live" : "offline",
      online: toInt(room?.room_view_stats?.display_value),
      introduction: strOr(room.intro),
      // stream_url 藏 play 数据,供下游 getPlayQualities/Urls(本地解析)。
      raw: streamUrl,
    }
  }

  private channelOptions(info: SourceInfo): SerializeOptions {
    return { channelTitle: `抖音直播 ${String(info.roomIds ?? info.roomId ?? "")}`, channelLink: `${LIVE}/${String(info.roomIds ?? info.roomId ?? "")}` }
  }

  // ── internals ───────────────────────────────────────────────────────────

  /** 拉 enter 接口完整响应(room/user/stream_url 同源)。ABogus 签名 + ttwid cookie。 */
  private async fetchRoomDetail(roomId: string): Promise<Record<string, any>> {
    // 参数序列复刻 dart douyin_site.dart:503;ABogus 签名(signDouyinUrl 追加随机 msToken + a_bogus)。
    const url = await signDouyinUrl(`${LIVE}/webcast/room/web/enter/?${enterRoomParams(roomId)}`, UA)
    // enter API 用动态 Referer(含房间号)——复刻 dart douyin_site.dart:487(参考 DouyinLiveRecorder)。
    return this.getJson(url, `${LIVE}/${roomId}`)
  }

  private async getJson(url: string, referer?: string): Promise<Record<string, any>> {
    await this.ensureCookie()
    const json = await httpJson<Record<string, any>>(url, {
      "user-agent": UA,
      referer: referer ?? LIVE,
      authority: "live.douyin.com",
      cookie: this.cookieJar || DEFAULT_TTWID,
    })
    // 空 body(抖音常无合法 ttwid 返回空) → 抛错,不静默产空元数据。
    // httpJson 空 body 返回 null(「无数据」语义),无需 typeof 收窄。
    if (json == null) {
      throw new Error(`douyin empty body for ${url.slice(0, 80)}`)
    }
    // 抖音内容级错误:HTTP 200 但 body 带 status_code(如 4001038「内容无法查看」)。
    // 不抛会静默产出空元数据 → UI「直播没反应」且无法定位。抛清晰错误。
    const code = json?.status_code
    if (code !== undefined && code !== 0) {
      const msg = String(json?.prompts ?? json?.status_msg ?? `status_code=${code}`)
      throw new Error(`douyin 内容不可用:${msg}(code ${code})`)
    }
    return json
  }

  /**
   * 首页 warmup 抓新鲜 ttwid(Set-Cookie);失败兜底默认值。memoized。
   * 注意:依赖 HttpBackend 回传 `set-cookie` header(example 的 nodeBackend 返回空
   * headers,此时会兜底 DEFAULT_TTWID)。真实后端应回传 set-cookie。
   */
  private ensureCookie(): Promise<void> {
    if (this.cookieJar) return Promise.resolve()
    if (!this.cookiePromise) {
      this.cookiePromise = (async () => {
        try {
          const res = await globalThis.appHost.http.request({
            url: `${LIVE}/`,
            method: "GET",
            headers: { "user-agent": UA },
          })
          const sc = String(res.headers["set-cookie"] ?? "").split("\n")
          const jar = sc
            .map((c) => c.split(";")[0]!.trim())
            .filter((c) => c.includes("="))
            .join("; ")
          if (jar) this.cookieJar = jar
        } catch {
          this.cookieJar = DEFAULT_TTWID
        }
      })()
    }
    return this.cookiePromise
  }
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

/**
 * 从 reflow/info API 的 stream_url 提取 flv_pull_url 直链(reflow 主路径)。
 * reflow 返回 `flv_pull_url: {"FULL_HD1": "http...", "HD1": "...", ...}` 对象,
 * 键名即清晰度降序(FULL_HD1 最高)。hls_pull_url 是 m3u8,flv 优先返回。
 * 参照 dart_simple_live 的 flv_pull_url 解析(douyin_site.dart:564)。
 * 每档挂 quality 名 + rate(键名顺序倒序,高档 rate 大),供 MediaPlayer 画质切换。
 */
/** 抖音清晰度键名(键序即清晰度降序;HTML/reflow 解析共用)。 */
const QUALITY_ORDER = ["FULL_HD1", "HD1", "SD1", "SD2", "ORIGION"]
const DOUYIN_QUALITY_NAMES: Record<string, string> = {
  FULL_HD1: "蓝光",
  HD1: "高清",
  SD1: "标清",
  SD2: "流畅",
  ORIGION: "原画",
}
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
export { DouyinLiveHotChannel } from "./hot.ts"
