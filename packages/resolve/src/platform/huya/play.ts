/**
 * huya play —— 虎牙直播可播流解析(懒解析,resolveLivePlay 用)。
 *
 * 数据源:`mp.huya.com/cache.php?m=Live&do=profileRoom`(**干净 JSON API**)——
 * 一次拿全「线路 × 档位」,且 `stream.{flv,hls}.multiLine[].url` **已是拼好签名的
 * 完整直链**(含 wsSecret/fm/ctype=tars_mp),**不需要自己 buildAntiCode**。
 *
 * ⚠️ **2026-09 重写**(此前只取 m.huya.com HTML 的**首条 flv 线路 + 最高档**):
 *   1. 数据源换成 profileRoom API —— flv + hls **双协议**、每协议 5 条 CDN 线路;
 *   2. `hls.multiLine[].url` 自带 `ratio=` 档位参数 → **HLS 可切档**;
 *      flv 的 url 无 ratio(只出最高档),故低档位只产 HLS。
 *   3. 旧注释「PC 版被风控无线路」实测推翻(mp.huya.com 与 www.huya.com 均可用);
 *      旧注释「`&ratio=` 低档 flv.js 播几秒断」仅对 **flv** 成立,HLS 无此问题。
 *   4. `buildAntiCode` 随旧 HTML 路径一并删除(新 API 的 url 已含签名)。
 *
 * 档位(实测):蓝光10M(iBitRate=0,最高)/ 蓝光4M(4000)/ 超清(2000)/ 流畅(500)。
 * 选流契约:最高清晰度在前(档位原序输出)。
 *
 */

import type { Stream } from "@amoeba/xml"

import { httpJson } from "../../host.ts"
import { HUYA_HLS_UA } from "../../media-referrer.ts"
import { HUYA_UA, M_HUYA } from "./client.ts"

/**
 * 播放直链用的 UA(HYSDK PC 端,dart 同款)。字面量唯一权威在 `media-referrer.ts`
 * 的 `HUYA_HLS_UA` —— HLS CDN 只认这条串(浏览器 UA 403),Rust 网络层也用同一份。
 */
export const HUYA_PLAY_UA = HUYA_HLS_UA

/** profileRoom API → 按 CDN 归拢的一条线路(flv/hls 各一个完整签名直链)。 */
interface HuyaApiLine {
  cdn: string
  flvUrl: string
  hlsUrl: string
}

/** parseProfile 的产物:线路 + 档位(最高清晰度在前)。 */
interface HuyaApiProfile {
  lines: HuyaApiLine[]
  bitRates: Array<{ name: string; bitRate: number }>
}

/**
 * 从 `mp.huya.com/cache.php?m=Live&do=profileRoom` 取**全线路 + 全档位**。
 * ⚠️ 相较 m.huya.com HTML(HNF_GLOBAL_INIT):该 API 一次给 flv + hls **双协议**、
 * 每协议 5 条 CDN,且 `multiLine[].url` **已含完整签名**(wsSecret/fm/ctype=tars_mp)
 * ——**不需要 buildAntiCode**。
 */
function parseProfile(data: Record<string, any>): HuyaApiProfile {
  const stream = (data.stream ?? {}) as Record<string, any>
  const byCdn = new Map<string, HuyaApiLine>()
  const touch = (cdn: string): HuyaApiLine => {
    const e = byCdn.get(cdn)
    if (e) return e
    const created: HuyaApiLine = { cdn, flvUrl: "", hlsUrl: "" }
    byCdn.set(cdn, created)
    return created
  }
  const collect = (raw: unknown, key: "flvUrl" | "hlsUrl"): void => {
    for (const item of Array.isArray(raw) ? (raw as Record<string, any>[]) : []) {
      const cdn = String(item?.cdnType ?? "")
      const url = String(item?.url ?? "")
      if (cdn && url) touch(cdn)[key] = url
    }
  }
  collect(stream?.flv?.multiLine, "flvUrl")
  collect(stream?.hls?.multiLine, "hlsUrl")

  const rawBitRates = data?.liveData?.bitRateInfo
  let parsed: Array<Record<string, any>> = []
  if (typeof rawBitRates === "string" && rawBitRates.trim()) {
    try {
      const d = JSON.parse(rawBitRates)
      if (Array.isArray(d)) parsed = d
    } catch {
      /* 档位拿不到 → 走单流 */
    }
  } else if (Array.isArray(rawBitRates)) {
    parsed = rawBitRates
  }
  const bitRates = parsed
    .map((b) => ({ name: String(b?.sDisplayName ?? ""), bitRate: Number(b?.iBitRate ?? 0) }))
    .filter((b) => b.name && !b.name.includes("HDR"))
  return { lines: [...byCdn.values()].filter((l) => l.flvUrl || l.hlsUrl), bitRates }
}

/**
 * 覆盖/追加 HLS url 的 ratio 档位参数。
 * ⚠️ `bitRate=0`(原始最高档,如「蓝光15M」)**不传 ratio**——CDN 拒绝 `ratio=0`
 * (实测 tx/hs 线路回 403/404,去掉参数即 200),不带 ratio 本就是最高档。
 */
function withRatio(url: string, bitRate: number): string {
  if (!url || !bitRate) return url
  return /[?&]ratio=\d+/.test(url)
    ? url.replace(/([?&]ratio=)\d+/, `$1${bitRate}`)
    : `${url}${url.includes("?") ? "&" : "?"}ratio=${bitRate}`
}

/**
 * 懒解析虎牙直播流:**全档位 × 多线路**(flv + hls)。
 *
 * 数据源 `mp.huya.com/.../profileRoom`(干净 JSON,签名已拼好)——
 * 相较此前「m.huya.com HTML 首条 flv 线路 + 只返最高档」:
 *   - 双协议:hls 走 `ratio=` 切档(hls.js 无 flv 的分段重连问题),flv 仅最高档;
 *   - 多线路:每档展开各 CDN(CDN 名进 quality 后缀,player 按 rate 去重只取首条,
 *     其余留作后续失败降级的备选)。
 *
 * 选流契约:最高清晰度在前(档位原序),player `find` 链自然选到最高档。
 */
export async function resolveHuyaLivePlay(roomId: string): Promise<Stream[]> {
  const res = await httpJson<{ status?: number; data?: Record<string, any> }>(
    `https://mp.huya.com/cache.php?m=Live&do=profileRoom&roomid=${encodeURIComponent(roomId)}&showSecret=1`,
    { "user-agent": HUYA_UA, referer: "https://www.huya.com/", origin: "https://www.huya.com" },
  )
  const data = res?.data
  if (Number(res?.status) !== 200 || !data) throw new Error(`huya: profileRoom 失败(room ${roomId})`)
  const { lines, bitRates } = parseProfile(data)
  if (!lines.length) throw new Error(`huya: no stream for room ${roomId}(未开播或无线路)`)

  const headers = { referer: `${M_HUYA}/${roomId}`, "user-agent": HUYA_PLAY_UA }
  // 无档位 → 单流(HLS 优先,flv 兜底)。
  if (!bitRates.length) {
    const l = lines[0]!
    const url = l.hlsUrl || l.flvUrl
    return url ? [{ url, format: l.hlsUrl ? "hls" : "flv", headers }] : []
  }
  const out: Stream[] = []
  for (const [i, br] of bitRates.entries()) {
    const isTop = i === 0
    for (const line of lines) {
      // 每档都给 HLS(带该档 ratio)——低档也可切(flv 低档播不稳,故不产)。
      if (line.hlsUrl) {
        out.push({
          url: withRatio(line.hlsUrl, br.bitRate),
          format: "hls",
          headers,
          quality: `${br.name}·${line.cdn}`,
          rate: br.bitRate,
        })
      }
      if (isTop && line.flvUrl) {
        out.push({ url: line.flvUrl, format: "flv", headers, quality: `${br.name}·${line.cdn}`, rate: br.bitRate })
      }
    }
  }
  return out
}
