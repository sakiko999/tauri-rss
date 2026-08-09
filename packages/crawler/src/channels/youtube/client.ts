/**
 * InnerTubeClient — YouTube InnerTube player API 客户端(零登录)。
 *
 * 参照 NewPipeExtractor 的 YoutubeStreamHelper/YoutubeStreamExtractor:
 *   1. 拿 visitorData(必须,无则 playerResponse 无效)
 *   2. POST youtubei/v1/player(ANDROID client)→ playerResponse
 *   3. 解析 streamingData.formats/adaptiveFormats → 可播直链
 *
 * 策略:优先 ANDROID client 的**渐进式 mp4(音视频合一)**——直链无签名,
 * 浏览器原生可播。只有它缺失时才考虑纯视频(DASH)或签名解密。
 *
 * n 参数:HTML5 client 的 URL 带 `n=xxx`(节流混淆),不解 → 限速 50KB/s 或 403。
 * 本 client 在 resolve 后统一解 n(见 signature.ts 的 deobfuscateNParam)。
 */
import * as R from "ramda"
import type { Stream } from "@tauri-playground/xml"
import { getItag, isPlayableItag } from "./itag.ts"
import { deobfuscateNParam, hasThrottlingParam } from "./signature.ts"

const YOUTUBEI_V1 = "https://www.youtube.com/youtubei/v1"
const YOUTUBEI_GAPIS_V1 = "https://youtubei.googleapis.com/youtubei/v1"
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 12; Pixel 6 Build/SQ3A.220705.003; wv) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/103.0.0.0 Mobile Safari/537.36"
const WEB_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

/**
 * ANDROID client 版本(NewPipe 2026-01 的 ClientsConstants)。
 * ⚠️ 必须跟随 YouTube 更新:clientVersion 过老会被拒(400 Precondition check failed
 * 或 playability UNPLAYABLE)。曾用 19.09.37(2024)全部被拒,升到 21.03.36 即通。
 */
const ANDROID_CLIENT_VERSION = "21.03.36"
/** WEB client 版本(2026-01,NewPipe 同款)。 */
const WEB_CLIENT_VERSION = "2.20260120.01.00"
/**
 * iOS client 版本(NewPipe 2026-01)。**直播必需**:ANDROID client 直播时不返回
 * hlsManifestUrl,iOS/visionOS 才返回 HLS manifest(分离音视频)。
 */
const IOS_CLIENT_VERSION = "21.03.2"
const IOS_DEVICE_MODEL = "iPhone16,2"
const IOS_UA_VERSION = "18_7_2"
const IOS_UA = `com.google.ios.youtube/${IOS_CLIENT_VERSION}(${IOS_DEVICE_MODEL}; U; CPU iOS ${IOS_UA_VERSION} like Mac OS X; en)`

export interface PlayerFormat {
  itag: number
  url?: string
  cipher?: string
  signatureCipher?: string
  mimeType?: string
  bitrate?: number
  width?: number
  height?: number
  fps?: number
  qualityLabel?: string
}

interface PlayerResponse {
  videoDetails?: Record<string, any>
  playabilityStatus?: {
    status?: string
    reason?: string
    errorScreen?: Record<string, any>
    /** 直播判定:存在即直播中(liveStreamability 是对象,空对象也算)。 */
    liveStreamability?: unknown
  }
  streamingData?: {
    formats?: PlayerFormat[]
    adaptiveFormats?: PlayerFormat[]
    hlsManifestUrl?: string
    dashManifestUrl?: string
  }
}

/** 生成随机 cpn(content playback nonce,13 位 base64)。 */
export function generateCpn(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"
  let out = ""
  const random = (n: number) => Math.floor(Math.random() * n)
  for (let i = 0; i < 13; i++) out += chars[random(chars.length)]
  return out
}

async function postJson(url: string, body: unknown, headers: Record<string, string>): Promise<unknown> {
  const res = await globalThis.appHost.http.request({
    url,
    method: "POST",
    responseType: "json",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
  if (res.status < 200 || res.status >= 300) throw new Error(`YouTube HTTP ${res.status}: ${url}`)
  return res.body
}

/** 拿 visitorData(零登录,POST visitor_id 端点,response 在 responseContext.visitorData)。 */
export async function getVisitorData(): Promise<string> {
  const body = {
    context: { client: { clientName: "ANDROID", clientVersion: ANDROID_CLIENT_VERSION, androidSdkVersion: 30 } },
  }
  const res = (await postJson(
    `${YOUTUBEI_V1}/visitor_id?prettyPrint=false`,
    body,
    { "user-agent": ANDROID_UA, "X-Goog-Api-Format-Version": "2" },
  )) as { responseContext?: Record<string, any>; visitorData?: string }
  const vd = res?.responseContext?.["visitorData"]
  if (!vd) throw new Error("YouTube visitorData 获取失败")
  return vd
}

/** 请求 player API(ANDROID client)。 */
async function getAndroidPlayerResponse(videoId: string, visitorData: string): Promise<PlayerResponse> {
  const cpn = generateCpn()
  const body = {
    context: {
      client: {
        clientName: "ANDROID",
        clientVersion: ANDROID_CLIENT_VERSION,
        androidSdkVersion: 30,
        hl: "en",
        visitorData,
      },
    },
    videoId,
    cpn,
    contentCheckOk: true,
    racyCheckOk: true,
  }
  // ANDROID 走 gapis 端点 + t/id 参数(复刻 NewPipe getAndroidPlayerResponse:
  // YoutubeStreamHelper.java:150——YOUTUBEI_V1_GAPIS_URL + "&t=" + generateTParameter()
  // + "&id=" + videoId)。gapis 更稳定(绕开 www.youtube.com 的地域/风控)。iOS 同款。
  const res = (await postJson(
    `${YOUTUBEI_GAPIS_V1}/player?prettyPrint=false&t=${Date.now()}&id=${videoId}`,
    body,
    { "user-agent": ANDROID_UA, "X-Goog-Api-Format-Version": "2" },
  )) as PlayerResponse
  return res
}

/** 请求 player API(WEB client,fallback——URL 可能带签名,需要解)。 */
async function getWebPlayerResponse(videoId: string, visitorData: string): Promise<PlayerResponse> {
  const cpn = generateCpn()
  const body = {
    context: {
      client: {
        clientName: "WEB",
        clientVersion: WEB_CLIENT_VERSION,
        hl: "en",
        visitorData,
      },
    },
    videoId,
    cpn,
    contentCheckOk: true,
    racyCheckOk: true,
  }
  const res = (await postJson(
    `${YOUTUBEI_V1}/player?prettyPrint=false`,
    body,
    { "user-agent": WEB_UA, referer: `https://www.youtube.com/watch?v=${videoId}` },
  )) as PlayerResponse
  return res
}

/** 请求 player API(iOS client)——直播时返回 hlsManifestUrl(ANDROID 不返回)。 */
export async function getIosPlayerResponse(videoId: string, visitorData: string): Promise<PlayerResponse> {
  const cpn = generateCpn()
  const body = {
    context: {
      client: {
        clientName: "IOS",
        clientVersion: IOS_CLIENT_VERSION,
        deviceMake: "Apple",
        deviceModel: IOS_DEVICE_MODEL,
        hl: "en",
        visitorData,
      },
    },
    videoId,
    cpn,
    contentCheckOk: true,
    racyCheckOk: true,
  }
  // iOS client 用 gapis 端点 + t/id 参数(NewPipe 同款)。
  const res = (await postJson(
    `${YOUTUBEI_GAPIS_V1}/player?prettyPrint=false&t=${Date.now()}&id=${videoId}`,
    body,
    { "user-agent": IOS_UA, "X-Goog-Api-Format-Version": "2" },
  )) as PlayerResponse
  return res
}

/** 判定是否直播(playabilityStatus.liveStreamability → 直播中;isLiveContent 兜底)。 */
function isLiveContent(res: PlayerResponse): boolean {
  return Boolean(
    res.playabilityStatus?.liveStreamability || res.videoDetails?.isLiveContent || res.videoDetails?.isLive,
  )
}

function checkPlayability(res: PlayerResponse, videoId: string): void {
  const st = res.playabilityStatus
  if (st?.status === "OK") return
  const reason = st?.reason ?? st?.status ?? "unknown"
  if (/login_required|LOGIN_REQUIRED/i.test(reason) && st?.errorScreen) {
    const stReason = st.errorScreen?.["playerErrorMessageRenderer"]?.["reason"]?.["simpleText"]
    if (stReason && /private|age|members/i.test(stReason)) {
      throw new Error(`YouTube 视频不可播:${stReason}`)
    }
  }
  throw new Error(`YouTube 视频不可播(${reason}): https://www.youtube.com/watch?v=${videoId}`)
}

/**
 * 渐进式 mp4(音视频合一)优先。从 formats 里挑 itag 支持 + 最高的那条。
 * 优先顺序:渐进式视频(itag type=video)> 音频(audio)。
 */
export function pickProgressiveVideo(formats: PlayerFormat[]): PlayerFormat | null {
  // filter(可播 + 音视频合一 + 有可解 URL) → 按高度取最高(手写 maxBy 的 for/best 消掉)。
  const playable = (f: PlayerFormat): boolean => {
    const info = f.itag ? getItag(f.itag) : undefined
    if (!info || !isPlayableItag(info)) return false
    if (info.type !== "video") return false // 只挑音视频合一
    if (!f.url && !f.cipher && !f.signatureCipher) return false
    return true
  }
  const height = (f: PlayerFormat): number => (f.itag ? (getItag(f.itag)?.height ?? 0) : 0)
  // maxBy 比较严格大于 → height 相同时保留**第一个**(原 for+`>` 语义;sortBy+last 会取最后一个)。
  return R.reduce<PlayerFormat, PlayerFormat | null>(
    (best, f) => (best === null || height(f) > height(best) ? f : best),
    null,
    R.filter(playable, formats),
  )
}

/** 把 format 的 URL 解出来(签名解密 + n 参数解密)。返回可播 URL;失败返回 null。 */
export async function resolveFormatUrl(format: PlayerFormat): Promise<string | null> {
  let url = format.url
  if (!url) {
    // 签名混淆:url 藏在 cipher / signatureCipher 里(仅 WEB client)。
    const cipherStr = format.cipher ?? format.signatureCipher
    if (!cipherStr) return null
    const cipher = parseCipher(cipherStr)
    url = cipher.url
    // 需要解 s(签名)——当前 MVP 不实现 base.js 签名,直接放弃该流。
    if (cipher.s && !url.includes(`&${cipher.sp ?? "sig"}=`)) {
      return null
    }
  }
  if (!url) return null
  // n 参数(节流混淆)——不解会限速/403。
  if (hasThrottlingParam(url)) {
    try {
      url = await deobfuscateNParam(url)
    } catch {
      // n 参数解密失败 → 该流不可用,放弃。
      return null
    }
  }
  return url
}

function parseCipher(cipherStr: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of cipherStr.split("&")) {
    const [k, ...rest] = part.split("=")
    if (k) out[k] = decodeURIComponent(rest.join("="))
  }
  return out
}

/** 组装最终 Stream[](带 referer/UA header,浏览器原生 <video> 能播 mp4)。 */
export async function resolveYoutubeStreams(videoId: string): Promise<Stream[]> {
  const visitorData = await getVisitorData()

  // 1. ANDROID client(无签名,直链最干净)
  let res: PlayerResponse
  try {
    res = await getAndroidPlayerResponse(videoId, visitorData)
    checkPlayability(res, videoId)
  } catch (e) {
    // ANDROID 失败(如 age-restricted / 地区)→ fallback WEB。
    res = await getWebPlayerResponse(videoId, visitorData)
    checkPlayability(res, videoId)
  }

  const live = isLiveContent(res)
  // 直播:ANDROID 不返回 hlsManifestUrl,必须 iOS client。
  if (live) {
    try {
      const ios = await getIosPlayerResponse(videoId, visitorData)
      checkPlayability(ios, videoId)
      const hls = ios.streamingData?.hlsManifestUrl
      if (hls) {
        return [{ url: hls, format: "hls", headers: { referer: "https://www.youtube.com/", "user-agent": IOS_UA } }]
      }
    } catch (e) {
      console.warn("[youtube] iOS live 请求失败:", (e as Error)?.message)
    }
    // iOS 拿不到 HLS,回退 ANDROID/WEB 的 formats(若有)。
  }

  // 非直播(或 live 但 iOS 失败):渐进式 mp4 优先。
  const formats = res.streamingData?.formats ?? []
  const best = pickProgressiveVideo(formats)
  if (best) {
    const url = await resolveFormatUrl(best)
    if (url) {
      return [{ url, format: "mp4", headers: { referer: "https://www.youtube.com/", "user-agent": WEB_UA } }]
    }
  }

  // 2. 渐进式拿不到 → 试 HLS manifest(直播 / iOS)。
  const hls = res.streamingData?.hlsManifestUrl
  if (hls) {
    return [{ url: hls, format: "hls", headers: { referer: "https://www.youtube.com/" } }]
  }

  throw new Error(`YouTube 未找到可播直链: https://www.youtube.com/watch?v=${videoId}`)
}
