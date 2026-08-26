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
import { extractInlineJson } from "../../utils/inline-json.ts"
import { md5Hex } from "../../utils/md5.ts"
import { M_HUYA, HUYA_UA } from "./client.ts"

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
  // 强制 PC 平台(ctype=huya_pc_exe, t=0):移动页面(m.huya.com)线路是 tars_mobile,
  // flv.js 播不稳;用 PC anticode 让同一条 CDN 线路按 PC 平台出流(可稳定播放)。
  // fm/wsTime 仍取自页面签名(与平台无关的密钥)。
  const ctype = "huya_pc_exe"
  const platformId = 0
  const isWap = false

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

/**
 * 抓房间页(移动版 m.huya.com,应用环境抓取稳定) + 解析线路/档位。
 * 移动版数据在 `window.HNF_GLOBAL_INIT = {...}`:
 *   roomInfo.tLiveInfo.tLiveStreamInfo.vStreamInfo.value[] → 线路
 *   roomInfo.tLiveInfo.tLiveStreamInfo.vBitRateInfo.value[] → 档位
 * 线路虽是移动版 CDN(tars_mobile),但 buildAntiCode 强制 PC 平台出流(dart 同款思路)。
 * ⚠️ 不用 PC 版 www.huya.com(hyPlayerConfig)——Tauri Rust 隧道抓取被虎牙风控(无线路)。
 */
async function fetchFirstLine(roomId: string): Promise<{
  line: HuyaStreamLine
  presenterUid: number
  bitRates: Array<{ bitRate: number; name: string }>
} | null> {
  const html = await httpText(`${M_HUYA}/${roomId}`, { "user-agent": HUYA_UA })
  const info = parseHnfGlobalInit(html)
  const ri = (info.roomInfo ?? {}) as Record<string, any>
  const tLiveInfo = (ri.tLiveInfo ?? {}) as Record<string, any>
  const tLiveStreamInfo = (tLiveInfo.tLiveStreamInfo ?? {}) as Record<string, any>
  const lines = Array.isArray(tLiveStreamInfo?.vStreamInfo?.value)
    ? (tLiveStreamInfo.vStreamInfo.value as Record<string, any>[])
    : []
  if (!lines.length) return null
  for (const l of lines) {
    const flvUrl = String(l.sFlvUrl ?? "")
    const streamName = String(l.sStreamName ?? "")
    const flvAntiCode = String(l.sFlvAntiCode ?? "")
    if (flvUrl && streamName && flvAntiCode) {
      const presenterUid = Number(html.match(/lChannelId":([0-9]+)/)?.[1] ?? 0)
      // 档位(vBitRateInfo)。过滤 HDR;顺序保留(原画/蓝光在前)。
      const bitRates = (Array.isArray(tLiveStreamInfo?.vBitRateInfo?.value)
        ? (tLiveStreamInfo.vBitRateInfo.value as Record<string, any>[])
        : []
      )
        .map((b) => ({ bitRate: Number(b?.iBitRate ?? 0), name: String(b?.sDisplayName ?? "") }))
        .filter((b) => b.name && !b.name.includes("HDR"))
      return { line: { flvUrl, streamName, flvAntiCode }, presenterUid, bitRates }
    }
  }
  return null
}

/**
 * 懒解析虎牙直播流,返回**最高档**(无 ratio 参数,稳定)。
 * ⚠️ 实测:huya 的 `&ratio=` 低档在 flv.js 下播几秒即断(服务端分段重连),只有
 * 最高档(bitRate=0, 不带 ratio)能稳定持续播放。所以只返回最高档——档位切换
 * 在 douyu/bili/douyin 已可用,huya 的 ratio 方案受 flv.js 限制放弃。
 * 若无档位信息则返回单流(原始 base)。
 */
export async function resolveHuyaLivePlay(roomId: string): Promise<Stream[]> {
  const found = await fetchFirstLine(roomId)
  if (!found) throw new Error(`huya: no stream for room ${roomId}(未开播或无线路)`)
  const { line, presenterUid, bitRates } = found
  const anticode = buildAntiCode(line.streamName, presenterUid, line.flvAntiCode, Date.now())
  const headers = { referer: `${M_HUYA}/${roomId}`, "user-agent": HUYA_PLAY_UA }
  const base = `${line.flvUrl}/${line.streamName}.flv?${anticode}&codec=264`

  // 最高档 = bitRate 最小(原画/蓝光20M),不加 ratio(加 ratio 的档 flv.js 播不稳)。
  const top = bitRates[0]
  if (!top) return [{ url: base, format: "flv", headers }]
  return [{ url: base, format: "flv", headers, quality: top.name, rate: top.bitRate }]
}

/**
 * 解析 `window.HNF_GLOBAL_INIT = {...}`(共用 extractInlineJson 平衡括号截取,
 * 页面嵌套深时非贪婪正则会截断)。channel 元数据解析与 play 解析共用。
 * 虎牙 JSON 里混入函数表达式(`function(){}`),parse 前归一为空串。
 */
export function parseHnfGlobalInit(html: string): Record<string, any> {
  return extractInlineJson(
    html,
    "HNF_GLOBAL_INIT",
    (s) => s.replace(/function\s*\([^)]*\)\s*\{[\s\S]*?\}/g, '""'),
    "Huya HNF_GLOBAL_INIT",
  )
}
