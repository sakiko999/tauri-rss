/**
 * douyu 直播房间 channel —— HTTP + CryptoJS 签名(host.js)。
 *
 * 复刻 producer 的 DouyuSite.getRoomDetail:爬 `betard/{roomId}` 取房间信息,
 * `swf_api/homeH5Enc` 取签名 JS blob(crptext),用 host.js 执行
 * `CRYPTO_JS + crptext` 里的 `ub98484234(roomId, did, time)` 得到签名 body。
 *
 * 签名只用于 getH5Play(拉 RTMP 直链)。本 channel 产出 Live Item(状态+元数据),
 * playUrls 需额外 H5Play 请求,交由下游 resolveLivePlay 懒解析(同 huya)。
 */
import * as R from "ramda"
import type { Item, Live, Stream } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { LivePlayable, RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch } from "../factory.ts"
import { now } from "../../host.ts"
import { CRYPTO_JS } from "./cryptojs.ts"

const BASE = "https://www.douyu.com"
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36"

const DID = "10000000000000000000000000001501"

export class DouyuLiveChannel implements RssChannel {
  readonly key = "live:douyu"
  readonly name = "斗鱼直播房间"
  readonly kind = "live" as const
  readonly sourceInfoTpl = [{ key: "roomId", label: "直播间 ID", required: true }]
  // 直播源:implements LivePlayable,resolveLivePlay 闭包捕获 this 实例状态(签名重取)。
  getSource(info: SourceInfo): RssSource & LivePlayable {
    return {
      fetch: apiFetch(() => this.fetchItems(info), () => this.channelOptions(info)),
      resolveLivePlay: (roomId) => this.resolveLivePlayImpl(roomId),
    }
  }

  /**
   * 懒解析直播流,返回**全档位**(每档一个 Stream,quality=档位名,rate 藏在 headers):
   *   1. POST getH5Play 带 rate=-1 → 响应 multirates 列出本房间可用档位(rate 值→中文名);
   *   2. 逐档重发 getH5Play(rate=档位值) → 该档 RTMP/HTTP-FLV 直链。
   * 签名带时间戳,resolve 时重取。多档位让下游 MediaPlayer 展示画质切换。
   */
  private async resolveLivePlayImpl(roomId: string): Promise<Stream[]> {
    const crptext = await this.fetchSignPayload(roomId)
    const signed = this.sign(crptext, roomId)

    // 1. 列档位 + 可用 CDN(复刻 dart getPlayQualites:douyu_site.dart:95)。
    //    rate=-1 只回 multirates + cdnsWithName(不产流),按服务端顺序(高档在前)。
    const listRes = await this.getH5PlayData(roomId, `${signed}&cdn=&rate=-1`)
    const multirates = Array.isArray(listRes?.multirates)
      ? (listRes.multirates as Array<Record<string, any>>)
      : []
    const qualities = multirates
      .map((m) => ({ rate: toInt(m.rate), name: String(m.name ?? "") }))
      .filter((q): q is { rate: number; name: string } => q.rate !== undefined && !!q.name)
    // 可用 CDN(cdnsWithName,scdn 排后——dart 同款,scdn 优先兜底)。
    const cdns = (Array.isArray(listRes?.cdnsWithName) ? listRes.cdnsWithName : [])
      .map((c) => String((c as Record<string, any>)?.cdn ?? ""))
      .filter(Boolean)
      .sort((a, b) => Number(a.startsWith("scdn")) - Number(b.startsWith("scdn")))

    // 2. 逐档拉真实直链(复刻 dart getPlayUrls:douyu_site.dart:134——遍历所有 CDN,
    //    单个 cdn 失败换下一个,返回首个可用)。首档全 CDN 失败则整体报错;其余档失败跳过。
    const streams: Stream[] = []
    for (const [idx, q] of qualities.entries()) {
      try {
        const s = await this.getH5Play(roomId, signed, q.rate, cdns)
        if (s) streams.push({ ...s, quality: q.name, rate: q.rate })
      } catch (e) {
        if (idx === 0) throw e
        console.warn(`[douyu] 档位 ${q.name}(rate=${q.rate}) 解析失败,跳过:`, (e as Error)?.message)
      }
    }
    if (!streams.length) {
      // 兜底:multirates 为空(房间异常)时按 rate=-1 直接拿单流。
      const s = await this.getH5Play(roomId, signed, -1, cdns)
      if (s) streams.push(s)
    }
    if (!streams.length) throw new Error(`douyu H5Play: no stream for room ${roomId}`)
    // 契约:最高清晰度排最前(player 默认选流取第一个)。multirates 服务端顺序
    // 理论上高档在前,不依赖它,显式按 rate 降序兜底(bili/youtube 同款写法)。
    return R.sortWith([R.descend((s: Stream) => s.rate ?? 0)], streams)
  }

  private async fetchItems(info: SourceInfo): Promise<Item[]> {
    const roomId = info.roomId ?? ""
    if (!roomId) throw new Error("live:douyu 需要 roomId")

    const roomInfo = await this.getRoomInfo(roomId)
    const crptext = await this.fetchSignPayload(roomId)
    const signed = this.sign(crptext, roomId)

    const live: Live = {
      id: `douyu:${roomId}`,
      sourceId: "live:douyu",
      kind: "live",
      title: String(roomInfo.room_name ?? ""),
      url: `${BASE}/${roomId}`,
      thumbnail: String(roomInfo.room_pic ?? ""),
      author: { name: String(roomInfo.owner_name ?? ""), avatar: String(roomInfo.owner_avatar ?? "") || undefined },
      fetchedAt: now(),
      platform: "douyu",
      roomId: String(roomInfo.room_id ?? roomId),
      liveStatus: toInt(roomInfo.show_status) === 1 && toInt(roomInfo.videoLoop) !== 1 ? "live" : "offline",
      online: toInt(roomInfo.room_biz_all?.hot),
      isRecord: toInt(roomInfo.videoLoop) === 1,
      introduction: strOr(roomInfo.show_details),
      // 签名 body 存 raw,供下游 resolveLivePlay 复用(带 CDN/rate 的 H5Play body)。
      raw: signed,
    }
    return [live]
  }

  private channelOptions(info: SourceInfo): SerializeOptions {
    return { channelTitle: `斗鱼直播 ${info.roomId ?? ""}`, channelLink: `${BASE}/${info.roomId ?? ""}` }
  }

  // ── internals ───────────────────────────────────────────────────────────

  /** 运行 CryptoJS + crptext,调用 ub98484234(roomId, did, time) 得签名串。 */
  private sign(crptext: string, roomId: string): string {
    const time = Math.floor(now() / 1000)
    const code = `${CRYPTO_JS}\n${crptext}`
    const result = globalThis.appHost.js.call(code, "ub98484234", [roomId, DID, time])
    return typeof result === "string" ? result : String(result ?? "")
  }

  private async fetchSignPayload(roomId: string): Promise<string> {
    const res = await this.getJson(`${BASE}/swf_api/homeH5Enc?rids=${roomId}`)
    return String(res?.data?.[`room${roomId}`] ?? "")
  }

  /**
   * POST getH5Play 拿可播流(复刻 dart getPlayUrls:douyu_site.dart:151)。
   * body = 签名串 + cdn/rate 选择;遍历所有 CDN,单个失败换下一个,返回首个可用。
   * 响应 data.rtmp_url + data.rtmp_live 拼接成完整地址(rtmp_live 带 HTML 实体需 unescape)。
   *
   * 关键:body **不能带** `ver=Douyu_223061205&iar=1&ive=1&hevc=0&fa=0`——实测带这些
   * 参数服务端强制降到最高档(rate 参数失效),只有 `&cdn=&rate=N` 才能按档位切。
   * 参照 dart_simple_live 的 getPlayUrl(只拼 `&cdn=$cdn&rate=$rate`)。
   *
   * 注意:实测 `rtmp_url` 返回的是 **https 的 HTTP-FLV 地址**(`edgesrv.com:8443/live/xxx.flv`),
   * 前 4 字节是标准 FLV 头(46 4c 56 01)——浏览器可用 flv.js 直接播。format 按 URL 协议判定:
   *   - https/http 的 .flv → "flv"(HTTP-FLV);
   *   - rtmp:// → "rtmp"(浏览器播不了,flv.js 也仅支持 http-flv)。
   */
  private async getH5Play(roomId: string, signed: string, rate: number, cdns: string[]): Promise<Stream | undefined> {
    // cdn 为空列表时补一个空串(等价 `cdn=`,服务端默认线路)——dart 的 cdnsWithName 必有值。
    const list = cdns.length ? cdns : [""]
    let lastErr: unknown
    for (const cdn of list) {
      try {
        const postBody = `${signed}&cdn=${cdn}&rate=${rate}`
        const data = await this.getH5PlayData(roomId, postBody)
        const base = String(data?.rtmp_url ?? "")
        const live = htmlUnescape(String(data?.rtmp_live ?? ""))
        if (!base || !live) {
          lastErr = new Error("no stream")
          continue
        }
        const url = `${base}/${live}`
        const format = /^https?:\/\//i.test(url) ? "flv" : "rtmp"
        return { url, format, headers: { referer: `${BASE}/${roomId}`, "user-agent": UA } }
      } catch (e) {
        lastErr = e
        console.warn(`[douyu] cdn=${cdn} rate=${rate} 失败,换下一个:`, (e as Error)?.message)
      }
    }
    throw lastErr ?? new Error(`douyu H5Play: no stream for room ${roomId}`)
  }

  /** POST getH5Play 返回原始 data(rtmp_url/rtmp_live/multirates 同源)。body 由调用方拼好(含 cdn/rate)。 */
  private async getH5PlayData(roomId: string, postBody: string): Promise<Record<string, any> | undefined> {
    const res = await globalThis.appHost.http.request({
      url: `${BASE}/lapi/live/getH5Play/${roomId}`,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": UA,
        referer: `${BASE}/${roomId}`,
      },
      body: postBody,
      responseType: "json",
    })
    if (res.status < 200 || res.status >= 300) throw new Error(`douyu H5Play HTTP ${res.status}`)
    return (res.body as Record<string, any>)?.data as Record<string, any> | undefined
  }

  private async getRoomInfo(roomId: string): Promise<Record<string, any>> {
    const res = await globalThis.appHost.http.request({
      url: `${BASE}/betard/${roomId}`,
      method: "GET",
      responseType: "json",
      headers: { "user-agent": UA, referer: `${BASE}/${roomId}` },
    })
    if (res.status < 200 || res.status >= 300) throw new Error(`douyu HTTP ${res.status}: betard/${roomId}`)
    const body = res.body
    // betard 对风控/停播房间可能返回 HTML 提示页(反爬),此时 JSON.parse 报错难读。
    if (typeof body === "string" && body.trimStart().startsWith("<")) {
      throw new Error(`douyu: 房间 ${roomId} 未返回房间信息(疑似风控,需浏览器环境验证)`)
    }
    const parsed = objBody(body)
    // betard 可能双编码(字符串套字符串)。
    const obj: Record<string, any> = typeof parsed === "string" ? (JSON.parse(parsed) as Record<string, any>) : parsed
    return (obj.room ?? obj) as Record<string, any>
  }

  private async getJson(url: string): Promise<Record<string, any>> {
    const res = await globalThis.appHost.http.request({
      url,
      method: "GET",
      responseType: "json",
      headers: { "user-agent": UA },
    })
    if (res.status < 200 || res.status >= 300) throw new Error(`douyu HTTP ${res.status}: ${url}`)
    // backend 已按 responseType:"json" 解析,body 是对象。
    return objBody(res.body)
  }
}

function objBody(body: unknown): Record<string, any> {
  if (typeof body === "string") return JSON.parse(body) as Record<string, any>
  return (body ?? {}) as Record<string, any>
}

function toInt(v: unknown): number | undefined {
  const n = Number(v)
  return Number.isFinite(n) && v !== null && v !== undefined && v !== "" ? n : undefined
}

function strOr(v: unknown): string | undefined {
  return v === undefined || v === null || v === "" ? undefined : String(v)
}

/** 反转 HTML 实体(rtmp_live 常带 &amp; 等)。按 producer 同款表转。 */
function htmlUnescape(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
}
