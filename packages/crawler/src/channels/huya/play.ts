/**
 * huya play —— 虎牙直播可播流解析(懒解析,resolveLivePlay 用)。
 *
 * 复刻 dart_simple_live 的 huya_site.dart buildAntiCode。**纯 HTTP + 计算**,
 * 无 Tars 二进制 codec 依赖(之前误判为需要 Tars 而跳过,已实测推翻):
 *   1. 抓 `m.huya.com/{roomId}` 的 HNF_GLOBAL_INIT
 *   2. 取 vStreamInfo.value[] 线路(sFlvUrl + sFlvAntiCode + sStreamName)
 *   3. 从 HTML 提取 lChannelId(主播 uid,作 presenterUid)
 *   4. buildAntiCode(纯 MD5/base64/位运算)重建签名参数
 *   5. 拼 `sFlvUrl/sStreamName.flv?anticode&codec=264`
 *
 * 实测(2026-08):HTTP 200 + 前 4 字节 `FLV\x01`(标准 FLV 头),flv.js 可播。
 */
import type { Stream } from "@tauri-playground/xml"
import { httpText } from "../../host.ts"
import { md5Hex } from "../../utils/md5.ts"

const M_HUYA = "https://m.huya.com"
const UA_MOBILE =
  "Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36"
/** 播放 FLV 用的 UA(HYSDK PC 端,dart 同款)。 */
export const HUYA_PLAY_UA =
  "HYSDK(Windows, 30000002)_APP(pc_exe&7060000&official)_SDK(trans&2.32.3.5646)"

/** 从 HNF_GLOBAL_INIT 里取的一条可播线路。 */
interface HuyaStreamLine {
  flvUrl: string
  streamName: string
  flvAntiCode: string
}

/** rotl64 低 32 位循环左移 8 位(JS 用 32 位无符号模拟)。 */
function rotl64(v: number): number {
  const low = v >>> 0
  return ((low << 8) | (low >>> 24)) >>> 0
}

/** base64 → utf8(dart utf8.decode(base64.decode()) 对应;浏览器/Node 通用)。 */
function base64ToUtf8(b64: string): string {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder("utf-8").decode(bytes)
}

/**
 * 重建 anticode(dart HuyaSite.buildAntiCode 的 TS 移植)。
 * @param stream        sStreamName
 * @param presenterUid  lChannelId(主播 uid)
 * @param antiCodeQuery 页面 sFlvAntiCode(完整 query 串,含 fm/wsTime/ctype/t)
 * @param nowMs         当前 epoch ms(测试可注入)
 */
export function buildAntiCode(stream: string, presenterUid: number, antiCodeQuery: string, nowMs: number): string {
  const params = new URLSearchParams(antiCodeQuery)
  const ctype = params.get("ctype") ?? "huya_pc_exe"
  const platformId = Number(params.get("t") ?? "0")
  const isWap = platformId === 103

  const seqId = presenterUid + nowMs
  const secretHash = md5Hex(`${seqId}|${ctype}|${platformId}`)
  const convertUid = rotl64(presenterUid)
  const calcUid = isWap ? presenterUid : convertUid
  const fmRaw = params.get("fm") ?? ""
  const fm = decodeURIComponent(fmRaw)
  const secretPrefix = base64ToUtf8(fm).split("_")[0]
  const wsTime = params.get("wsTime") ?? ""
  const secretStr = `${secretPrefix}_${calcUid}_${stream}_${secretHash}_${wsTime}`
  const wsSecret = md5Hex(secretStr)

  // 随机因子(uuid / ct)——dart 用 Random,这里 Math.random 即可。
  const ct = Math.floor((parseInt(wsTime, 16) + Math.random()) * 1000)
  const uuid = Math.floor((((ct % 1e10) + Math.random()) * 1e3) % 0xffffffff).toString()

  const out: Record<string, string> = {
    wsSecret,
    wsTime,
    seqid: String(seqId),
    ctype,
    ver: "1",
    fs: params.get("fs") ?? "",
    fm: encodeURIComponent(fmRaw),
    t: String(platformId),
  }
  if (isWap) {
    out.uid = String(presenterUid)
    out.uuid = uuid
  } else {
    out.u = String(convertUid)
  }
  return Object.entries(out)
    .map(([k, v]) => `${k}=${v}`)
    .join("&")
}

/** 抓房间页 + 解析线路,返回第一条可用 FLV 线路与 presenterUid。 */
async function fetchFirstLine(roomId: string): Promise<{ line: HuyaStreamLine; presenterUid: number } | null> {
  const html = await httpText(`${M_HUYA}/${roomId}`, { "user-agent": UA_MOBILE })
  const info = parseHnfGlobalInit(html)
  const ri = (info.roomInfo ?? {}) as Record<string, any>
  const tLiveInfo = (ri.tLiveInfo ?? {}) as Record<string, any>
  const lines = Array.isArray(tLiveInfo?.tLiveStreamInfo?.vStreamInfo?.value)
    ? (tLiveInfo.tLiveStreamInfo.vStreamInfo.value as Record<string, any>[])
    : []
  if (!lines.length) return null
  for (const l of lines) {
    const flvUrl = String(l.sFlvUrl ?? "")
    const streamName = String(l.sStreamName ?? "")
    const flvAntiCode = String(l.sFlvAntiCode ?? "")
    if (flvUrl && streamName && flvAntiCode) {
      // presenterUid = lChannelId(主播 uid),HTML 里嵌着,不在 JSON 内。
      const presenterUid = Number(html.match(/lChannelId":([0-9]+)/)?.[1] ?? 0)
      return { line: { flvUrl, streamName, flvAntiCode }, presenterUid }
    }
  }
  return null
}

/** 懒解析虎牙直播流:返回 HTTP-FLV 直链数组(flv.js 可播)。 */
export async function resolveHuyaLivePlay(roomId: string): Promise<Stream[]> {
  const found = await fetchFirstLine(roomId)
  if (!found) throw new Error(`huya: no stream for room ${roomId}(未开播或无线路)`)
  const { line, presenterUid } = found
  const anticode = buildAntiCode(line.streamName, presenterUid, line.flvAntiCode, Date.now())
  // 拼接:AL/TX 等 CDN 线路,sFlvUrl 是 http。选第一条(通常是 al=阿里)。
  const url = `${line.flvUrl}/${line.streamName}.flv?${anticode}&codec=264`
  return [
    {
      url,
      format: "flv",
      headers: { referer: `${M_HUYA}/${roomId}`, "user-agent": HUYA_PLAY_UA },
    },
  ]
}

/**
 * 解析 `window.HNF_GLOBAL_INIT = {...}`(替换内联 function 让 JSON.parse 通过)。
 * channel 元数据解析与 play 解析共用。
 */
export function parseHnfGlobalInit(html: string): Record<string, any> {
  const blockMatch = html.match(/window\.HNF_GLOBAL_INIT\s*=\s*(\{[\s\S]*?\})\s*<\/script>/)
  if (!blockMatch?.[1]) throw new Error("Huya: window.HNF_GLOBAL_INIT block not found")
  let raw = blockMatch[1]
  raw = raw.replace(/function\s*\(.*?\)\s*\{[\s\S]*?\}/g, '""')
  try {
    return JSON.parse(raw)
  } catch {
    const start = raw.indexOf("{")
    const end = raw.lastIndexOf("}")
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1))
    throw new Error("Huya: failed to parse HNF_GLOBAL_INIT JSON")
  }
}
