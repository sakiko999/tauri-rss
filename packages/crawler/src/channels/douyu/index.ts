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
import type { Item, Live, Stream } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { RssChannel, SourceInfo } from "../../index.ts"
import { createApiSource } from "../factory.ts"
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
  // 懒解析能力作为 factory capabilities 装配进 source(闭包捕获 this 私有逻辑)。
  getSource = createApiSource(
    (info) => this.fetchItems(info),
    (info) => this.channelOptions(info),
    { resolveLivePlay: (roomId) => this.resolveLivePlayImpl(roomId) },
  )

  /** 懒解析直播流:重取签名 body → POST getH5Play → RTMP 直链。签名带时间戳,resolve 时重取。 */
  private async resolveLivePlayImpl(roomId: string): Promise<Stream[]> {
    const crptext = await this.fetchSignPayload(roomId)
    const signed = this.sign(crptext, roomId)
    return this.getH5Play(roomId, signed)
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
   * POST getH5Play 拿 RTMP 直链。body = 签名串 + cdn/rate 选择;
   * 响应 data.rtmp_url + data.rtmp_live 拼接成完整地址(rtmp_live 带 HTML 实体需 unescape)。
   */
  private async getH5Play(roomId: string, signed: string): Promise<Stream[]> {
    const postBody = `${signed}&cdn=&rate=-1&ver=Douyu_223061205&iar=1&ive=1&hevc=0&fa=0`
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
    const data = (res.body as Record<string, any>)?.data as Record<string, any> | undefined
    const rtmpUrl = String(data?.rtmp_url ?? "")
    const rtmpLive = htmlUnescape(String(data?.rtmp_live ?? ""))
    if (!rtmpUrl || !rtmpLive) throw new Error(`douyu H5Play: no stream for room ${roomId}`)
    return [
      {
        url: `${rtmpUrl}/${rtmpLive}`,
        format: "rtmp",
        headers: { referer: `${BASE}/${roomId}`, "user-agent": UA },
      },
    ]
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
