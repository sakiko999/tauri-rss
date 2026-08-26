/**
 * douyu 平台客户端 —— CryptoJS 签名 + H5Play 拉流 + 房间信息。
 *
 * 无状态单例:签名/请求全从参数取(cookie/referer 每次传)。从 DouyuLiveChannel
 * 下沉(原 channel 私有方法)。签名脚本 CRYPTO_JS 经 host.js 执行。
 */
import type { Stream } from "@tauri-playground/xml"
import { httpGet, httpJson, now } from "../../host.ts"
import { log } from "../../log.ts"
import { toInt } from "../../utils/number.ts"
import { CRYPTO_JS } from "./cryptojs.ts"
import { douyuDanmakuStream } from "./danmaku.ts"
import type { PlatformClient, PlatformRequestOptions } from "../types.ts"

const BASE = "https://www.douyu.com"
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36"
const DID = "10000000000000000000000000001501"

/** 无状态 douyu 客户端:getJson 统一入口 + 弹幕 + 特有签名/拉流/房间方法。 */
export const douyuClient = {
  /** 带 UA 的 JSON 请求(homeH5Enc 等);对齐接口契约透传 referer/cookie。 */
  async getJson<T = any>(url: string, opts?: PlatformRequestOptions): Promise<T> {
    return httpJson<T>(url, {
      "user-agent": UA,
      ...(opts?.referer ? { referer: opts.referer } : {}),
      ...(opts?.cookie ? { cookie: opts.cookie } : {}),
      ...opts?.headers,
    })
  },
  /** 弹幕流(无鉴权 STT)。 */
  getDanmaku: (roomId) => douyuDanmakuStream(roomId),
} satisfies PlatformClient

/** 运行 CryptoJS + crptext,调用 ub98484234(roomId, did, time) 得签名串。 */
export function douyuSign(crptext: string, roomId: string): string {
  const time = Math.floor(now() / 1000)
  const code = `${CRYPTO_JS}\n${crptext}`
  const result = globalThis.appHost.js.call(code, "ub98484234", [roomId, DID, time])
  return typeof result === "string" ? result : String(result ?? "")
}

/** 抓 homeH5Enc 签名 payload(roomId → crptext JS blob)。 */
export async function douyuSignPayload(roomId: string): Promise<string> {
  const res = await douyuClient.getJson<{ data?: Record<string, unknown> }>(`${BASE}/swf_api/homeH5Enc?rids=${roomId}`)
  return String(res?.data?.[`room${roomId}`] ?? "")
}

/** 房间信息(betard/{roomId};风控/停播返回 HTML 时抛清晰错误,双编码 JSON 解一层)。 */
export async function douyuRoomInfo(roomId: string): Promise<Record<string, any>> {
  const res = await httpGet(`${BASE}/betard/${roomId}`, { "user-agent": UA, referer: `${BASE}/${roomId}` })
  if (res.status < 200 || res.status >= 300) throw new Error(`douyu HTTP ${res.status}: betard/${roomId}`)
  const text = res.bodyText
  if (text.trimStart().startsWith("<")) {
    throw new Error(`douyu: 房间 ${roomId} 未返回房间信息(疑似风控,需浏览器环境验证)`)
  }
  const parsed = JSON.parse(text) as Record<string, any>
  const obj: Record<string, any> = typeof parsed === "string" ? (JSON.parse(parsed) as Record<string, any>) : parsed
  return (obj.room ?? obj) as Record<string, any>
}

/** POST getH5Play 返回原始 data(rtmp_url/rtmp_live/multirates 同源)。body 由调用方拼好(含 cdn/rate)。 */
async function douyuH5PlayData(roomId: string, postBody: string): Promise<Record<string, any> | undefined> {
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

/**
 * 遍历所有 CDN 拉一档可播流(单个失败换下一个,返回首个可用)。
 * body **不能带** `ver=...&iar=1`(服务端强制降档,rate 失效)——只拼 `&cdn=&rate=N`。
 */
export async function douyuResolveH5Play(
  roomId: string,
  signed: string,
  rate: number,
  cdns: string[],
): Promise<Stream | undefined> {
  const list = cdns.length ? cdns : [""]
  let lastErr: unknown
  for (const cdn of list) {
    try {
      const postBody = `${signed}&cdn=${cdn}&rate=${rate}`
      const data = await douyuH5PlayData(roomId, postBody)
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
      log.douyu.warn(`cdn=${cdn} rate=${rate} 失败,换下一个:`, (e as Error)?.message)
    }
  }
  throw lastErr ?? new Error(`douyu H5Play: no stream for room ${roomId}`)
}

/**
 * 完整拉流流程:签名 → 列档位(rate=-1 的 multirates + cdns)→ 逐档拉直链。
 * 返回**全档位**(每档一个 Stream,quality=档位名,rate=档位值),按服务端顺序
 * (高档在前)。multirates 为空时 rate=-1 兜底单流。
 */
export async function douyuResolveStreams(roomId: string): Promise<Stream[]> {
  const crptext = await douyuSignPayload(roomId)
  const signed = douyuSign(crptext, roomId)

  // 1. 列档位 + 可用 CDN(rate=-1 只回 multirates + cdnsWithName,不产流)。
  const listRes = await douyuH5PlayData(roomId, `${signed}&cdn=&rate=-1`)
  const multirates = Array.isArray(listRes?.multirates) ? (listRes.multirates as Array<Record<string, any>>) : []
  const qualities = multirates
    .map((m) => ({ rate: toInt(m.rate), name: String(m.name ?? "") }))
    .filter((q): q is { rate: number; name: string } => q.rate !== undefined && !!q.name)
  // 可用 CDN(cdnsWithName,scdn 排后——dart 同款,scdn 优先兜底)。
  const cdns = (Array.isArray(listRes?.cdnsWithName) ? listRes.cdnsWithName : [])
    .map((c) => String((c as Record<string, any>)?.cdn ?? ""))
    .filter(Boolean)
    .sort((a, b) => Number(a.startsWith("scdn")) - Number(b.startsWith("scdn")))

  // 2. 逐档拉真实直链(首档全 CDN 失败整体报错;其余档失败跳过)。
  const streams: Stream[] = []
  for (const [idx, q] of qualities.entries()) {
    try {
      const s = await douyuResolveH5Play(roomId, signed, q.rate, cdns)
      if (s) streams.push({ ...s, quality: q.name, rate: q.rate })
    } catch (e) {
      if (idx === 0) throw e
      log.douyu.warn(`档位 ${q.name}(rate=${q.rate}) 解析失败,跳过:`, (e as Error)?.message)
    }
  }
  if (!streams.length) {
    // 兜底:multirates 为空(房间异常)时按 rate=-1 直接拿单流。
    const s = await douyuResolveH5Play(roomId, signed, -1, cdns)
    if (s) streams.push(s)
  }
  if (!streams.length) throw new Error(`douyu H5Play: no stream for room ${roomId}`)
  // 契约:最高清晰度排最前。streams 按 multirates 服务端顺序(高档在前),不按 rate 数值
  // 降序——douyu 的 rate 是服务端档位 ID 而非清晰度等级(2K60 的 rate 最小)。
  return streams
}

/** 反转 HTML 实体(rtmp_live 常带 &amp; 等)。 */
function htmlUnescape(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
}
