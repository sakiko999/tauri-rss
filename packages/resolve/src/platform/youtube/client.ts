/**
 * InnerTubeClient — YouTube InnerTube player API 客户端(零登录)。
 *
 * 参照 NewPipeExtractor 的 YoutubeStreamHelper/YoutubeStreamExtractor:
 *   1. 拿 visitorData(必须,无则 playerResponse 无效)
 *   2. POST youtubei/v1/player(ANDROID_VR client)→ playerResponse
 *   3. 解析 streamingData.formats/adaptiveFormats → 可播直链
 *
 * 策略:优先 **VISIONOS**(Apple Vision Pro;yt-dlp 2026-08 起的默认 client)——
 * 免 POT、实测直链(avc1 带 initRange/indexRange、无 n/cipher)、直播自带 hlsManifestUrl。
 * 失败再退 ANDROID_VR(Oculus Quest 3;退役中:2026-08-17 起 1.65.10 有全格式 403 记录),
 * 最后 WEB(2026 起 SABR-only,基本接不住)。
 * 2026-08 起 ANDROID/IOS 标准 client 部分 IP 触发 poToken(LOGIN_REQUIRED)。
 *
 * n 参数:HTML5 client 的 URL 带 `n=xxx`(节流混淆),不解 → 限速 50KB/s 或 403。
 * 本 client 在 resolve 后统一解 n(见 signature.ts 的 deobfuscateNParam)。
 */
import * as R from "ramda"
import type { Stream } from "@amoeba/xml"
import { formatError, log } from "../../log.ts"
import { buildMpd, type MpdAudioRep, type MpdVideoRep } from "../../utils/mpd.ts"
import { getItag, isPlayableItag } from "./itag.ts"
import { deobfuscateNParam, hasThrottlingParam } from "./signature.ts"
import { DESKTOP_CHROME_UA } from "../../utils/ua.ts"
import { createLiveChatPoller } from "./danmaku.ts"
import type { PlatformClient } from "../types.ts"


const YOUTUBEI_V1 = "https://www.youtube.com/youtubei/v1"
const YOUTUBEI_GAPIS_V1 = "https://youtubei.googleapis.com/youtubei/v1"
/** ANDROID_VR(Oculus Quest 3)UA —— 主力 client,2026-08 起免 poToken 直链。 */
const ANDROID_UA =
  "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; " +
  "eureka-user Build/SQ3A.220605.009.A1) gzip"
const WEB_UA = DESKTOP_CHROME_UA

/**
 * ANDROID_VR client 版本(yt-dlp master 2026-08)。**主力 client**。
 * ⚠️ ANDROID/IOS 标准 client 2026 年起部分 IP 触发 poToken(LOGIN_REQUIRED),VR
 * client 仍返回免 token 直链(渐进式 mp4 + adaptiveFormats;直播自带 hlsManifestUrl)。
 * ⚠️ 必须跟随更新:>1.65 可能返回 SABR-only;过老会被拒。曾用 21.03.36(ANDROID)换到
 * 1.65.10(ANDROID_VR)。注意:VR 不含 made-for-kids 视频(无 audio/video_only 流)。
 */
const ANDROID_CLIENT_VERSION = "1.65.10"
/** WEB client 版本(2026-01,NewPipe 同款)。 */
const WEB_CLIENT_VERSION = "2.20260120.01.00"
/**
 * iOS client 版本(NewPipe 2026-01)。**直播兜底**:ANDROID_VR 直播已自带
 * hlsManifestUrl(实测);iOS 用于 VR 无 hls 的直播形态(分离音视频)。
 */
const IOS_CLIENT_VERSION = "21.03.2"
const IOS_DEVICE_MODEL = "iPhone16,2"
const IOS_UA_VERSION = "18_7_2"
const IOS_UA = `com.google.ios.youtube/${IOS_CLIENT_VERSION}(${IOS_DEVICE_MODEL}; U; CPU iOS ${IOS_UA_VERSION} like Mac OS X; en)`

/**
 * VISIONOS(Apple Vision Pro)——**主力 client**(yt-dlp 2026-08 起的默认 client 之一)。
 *
 * 实测(2026-10-21,与 ANDROID_VR 同批对比 5 条视频):两者 status / 最高档完全一致
 * (均 1080p),`VISIONOS` 多出 AV1/VP9 档(我们用不上),avc1 全带 initRange/indexRange、
 * URL **无 `n` 参数、无 cipher**;直播返回 adaptive + `hlsManifestUrl`(iOS UA 取流实测 200)。
 * yt-dlp 的 POT 政策表里没有该 client = 不需要 poToken。
 *
 * ⚠️ **机房 IP 上并不比 VR 强**:复测 VR 失败的那 6 条 VOD,`VISIONOS` 同样 6/6
 * `LOGIN_REQUIRED`(只有极老牌的个别视频侥幸通过)——「机房 IP 救不了」是 IP 级结论,
 * 换 client 无效。
 *
 * ⚠️ 设备字段(`deviceModel`/`osName`/`osVersion`)是判据的一部分,缺了会被上游改判
 * playability(表现为「视频不可播」而不是报错)。
 */
export const VISIONOS_CLIENT_VERSION = "1.02"
const VISIONOS_DEVICE_MODEL = "RealityDevice17,1"
const VISIONOS_OS_VERSION = "26.5.23O471"
const VISIONOS_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15"

export interface PlayerFormat {
  itag: number
  url?: string
  /** adaptiveFormats 用 baseUrl 而非 url。 */
  baseUrl?: string
  cipher?: string
  signatureCipher?: string
  mimeType?: string
  bitrate?: number
  width?: number
  height?: number
  fps?: number
  qualityLabel?: string
  /** DASH 分片段信息(SegmentBase 用)。 */
  initRange?: { start: string; end: string }
  indexRange?: { start: string; end: string }
  contentLength?: string
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

/**
 * 风控信号上报(best-effort):宿主未注入 `net` 时静默,不影响请求/返回逻辑。
 * 契约 `appHost.net.reportRisk(platform, signal)` 见 docs/crawler-risk-control.md §2.6。
 */
function reportRisk(signal: string): void {
  // 宿主未注入 net 或调用方未注入 appHost 时静默(best-effort)
  globalThis.appHost?.net?.reportRisk("youtube", signal)
}

async function postJson(url: string, body: unknown, headers: Record<string, string>): Promise<unknown> {
  const res = await globalThis.appHost.http.request({
    url,
    method: "POST",
    responseType: "json",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
  if (res.status < 200 || res.status >= 300) {
    // 429 是 YouTube 限流/风控信号
    if (res.status === 429) reportRisk("429")
    throw new Error(`YouTube HTTP ${res.status}: ${url}`)
  }
  return res.body
}

let visitorDataPromise: Promise<string> | null = null

/** 拿 visitorData(零登录,POST visitor_id 端点,response 在 responseContext.visitorData)。
 *  session 级(非视频级)缓存:memoize,整个应用会话只 POST 一次;失败不缓存,下次重试。 */
export function getVisitorData(): Promise<string> {
  if (!visitorDataPromise) {
    visitorDataPromise = (async () => {
      const body = {
        context: {
          client: {
            clientName: "ANDROID_VR",
            clientVersion: ANDROID_CLIENT_VERSION,
            deviceMake: "Oculus",
            deviceModel: "Quest 3",
            androidSdkVersion: 32,
            osName: "Android",
            osVersion: "12L",
          },
        },
      }
      const res = (await postJson(
        `${YOUTUBEI_V1}/visitor_id?prettyPrint=false`,
        body,
        { "user-agent": ANDROID_UA, "X-Goog-Api-Format-Version": "2" },
      )) as { responseContext?: Record<string, any>; visitorData?: string }
      const vd = res?.responseContext?.["visitorData"]
      if (!vd) throw new Error("YouTube visitorData 获取失败")
      return vd
    })().catch((e: unknown) => {
      visitorDataPromise = null // 失败不缓存,下次调用重试
      throw e
    })
  }
  return visitorDataPromise
}

/**
 * POST 一次 InnerTube browse(WEB client + visitorData),返回原始 JSON。
 *
 * crawler 的直播页(热门/栏目)与频道视频列表用。固定 `hl:"en"`、`gl:"US"` ——
 * 栏目名是解析依据(`Live Now - Gaming` 等),跟随系统语言会让栏目名变成「正在直播」。
 *
 * `params`：tab 选择器（频道 Videos tab 用固定 params）；`continuation`：翻页令牌，
 * 与 browseId 二选一（InnerTube 的 continuation 请求不带 browseId）。
 */
export async function youtubeBrowse(
  browseId: string,
  opts: { params?: string; continuation?: string } = {},
): Promise<Record<string, any>> {
  const visitorData = await getVisitorData()
  const body: Record<string, unknown> = {
    context: {
      client: { clientName: "WEB", clientVersion: WEB_CLIENT_VERSION, hl: "en", gl: "US", visitorData },
    },
  }
  if (opts.continuation) body.continuation = opts.continuation
  else {
    body.browseId = browseId
    if (opts.params) body.params = opts.params
  }
  const res = await postJson(`${YOUTUBEI_V1}/browse?prettyPrint=false`, body, { "user-agent": WEB_UA })
  return res as Record<string, any>
}

/** 请求 player API(ANDROID_VR client——主力,免 poToken)。 */
async function getAndroidPlayerResponse(videoId: string, visitorData: string): Promise<PlayerResponse> {
  const cpn = generateCpn()
  const body = {
    context: {
      client: {
        clientName: "ANDROID_VR",
        clientVersion: ANDROID_CLIENT_VERSION,
        deviceMake: "Oculus",
        deviceModel: "Quest 3",
        androidSdkVersion: 32,
        osName: "Android",
        osVersion: "12L",
        hl: "en",
        visitorData,
      },
    },
    videoId,
    cpn,
    contentCheckOk: true,
    racyCheckOk: true,
  }
  // ANDROID_VR 走 gapis 端点 + t/id 参数(与 ANDROID 同款,复刻 NewPipe:
  // YoutubeStreamHelper.java:150——YOUTUBEI_V1_GAPIS_URL + "&t=" + generateTParameter()
  // + "&id=" + videoId)。gapis 更稳定(绕开 www.youtube.com 的地域/风控)。
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

/** 请求 player API(iOS client)——直播兜底(ANDROID_VR 无 hls 时用,分离音视频)。 */
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

/**
 * VISIONOS player 请求体(导出供自检钉住形状:设备字段缺失会静默变成「不可播」)。
 */
export function visionosPlayerBody(videoId: string, visitorData: string, cpn = generateCpn()) {
  return {
    context: {
      client: {
        clientName: "VISIONOS",
        clientVersion: VISIONOS_CLIENT_VERSION,
        deviceMake: "Apple",
        deviceModel: VISIONOS_DEVICE_MODEL,
        osName: "visionOS",
        osVersion: VISIONOS_OS_VERSION,
        hl: "en",
        gl: "US",
        visitorData,
      },
    },
    videoId,
    cpn,
    contentCheckOk: true,
    racyCheckOk: true,
  }
}

/** 请求 player API(VISIONOS client —— 免 POT 兜底,走 gapis + t/id 参数)。 */
async function getVisionosPlayerResponse(videoId: string, visitorData: string): Promise<PlayerResponse> {
  const res = (await postJson(
    `${YOUTUBEI_GAPIS_V1}/player?prettyPrint=false&t=${Date.now()}&id=${videoId}`,
    visionosPlayerBody(videoId, visitorData),
    { "user-agent": VISIONOS_UA, "X-Goog-Api-Format-Version": "2" },
  )) as PlayerResponse
  return res
}

/**
 * 取直播/视频的真实元信息(title / 频道名 / 是否直播中 / 观看数)。
 *
 * 供 crawler 的 `youtube:live` channel 用:此前它硬编码占位 title `"YouTube <id>"`、
 * 无 author、liveStatus 恒 "live"(声明态)。这里用一次 iOS player API 请求换成真实值。
 * 失败返回 null(调用方回退占位,**不阻塞**订阅)。
 */
export async function getYoutubeLiveMeta(videoId: string): Promise<{
  title: string
  author: string
  isLive: boolean
  online?: number
} | null> {
  try {
    const visitorData = await getVisitorData()
    const res = await getIosPlayerResponse(videoId, visitorData)
    const vd = res.videoDetails ?? {}
    const title = String(vd.title ?? "").trim()
    const author = String(vd.author ?? "").trim()
    if (!title && !author) return null
    // viewCount 是字符串;直播时是「当前观看」近似(YouTube 无官方并发字段)。
    const vc = Number(String(vd.viewCount ?? "").replace(/[^\d]/g, ""))
    return {
      title,
      author,
      isLive: isLiveContent(res),
      online: Number.isFinite(vc) && vc > 0 ? vc : undefined,
    }
  } catch {
    return null
  }
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
  // maxBy(height, f, best):f 更高 → f;相等 → best(保留第一个出现的,忠实原 for+`>` 语义)。
  // ⚠️ 参数顺序关键:maxBy 相等时返回**第二个**参数,所以必须是 (f, best) 而非 (best, f)
  //   (R.reduce(R.maxBy(height), ...) 里 acc=best 在前 → 相等取新 f,语义反了)。
  return R.reduce<PlayerFormat, PlayerFormat | null>(
    (best, f) => (best === null ? f : R.maxBy(height, f, best)),
    null,
    R.filter(playable, formats),
  )
}

/** 把 format 的 URL 解出来(签名解密 + n 参数解密)。返回可播 URL;失败返回 null。
 *  ⚠️ 传 videoId 供解 n 取 base.js(不能从直链正则抠——会抠到 CDN 主机名)。 */
export async function resolveFormatUrl(format: PlayerFormat, videoId: string): Promise<string | null> {
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
      url = await deobfuscateNParam(url, videoId)
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

/** 从 `codecs="avc1.640028"` 提取编码串。 */
function codecsFromMime(mimeType?: string): string | undefined {
  return /codecs="([^"]+)"/.exec(mimeType ?? "")?.[1]
}

/** 是否可拼 DASH 的 avc1 视频轨(mp4 + avc1 + 有段 Range + 有可解 URL)。 */
const isAvcVideo = (f: PlayerFormat): boolean =>
  /^video\/mp4/i.test(f.mimeType ?? "") &&
  /avc1/i.test(f.mimeType ?? "") &&
  !!f.initRange &&
  !!f.indexRange &&
  !!(f.baseUrl ?? f.url)

/** 是否可拼 DASH 的 AAC 音轨(mp4 + mp4a + 有段 Range + 有可解 URL)。 */
const isAacAudio = (f: PlayerFormat): boolean =>
  /^audio\/mp4/i.test(f.mimeType ?? "") &&
  /mp4a/i.test(f.mimeType ?? "") &&
  !!f.initRange &&
  !!f.indexRange &&
  !!(f.baseUrl ?? f.url)

/**
 * 从 adaptiveFormats 装配 DASH 全档位流(复刻 B 站 dashStreamsWithMpd)。
 *
 * YouTube adaptiveFormats 是音视频分离(video_only + audio),每个 format 带
 * initRange/indexRange(与 B 站 DASH 同构)——拼 SegmentBase MPD 存 dashManifest,
 * dash.js 双 SourceBuffer 合成播放。每档一个 Stream(format:"dash",MPD 只含该档
 * video + 公共最高音轨),天然锁目标档无 ABR 降档。
 *
 * ⚠️ 返回的 URL 必须过 resolveFormatUrl(统一解 n 参数 + 签名);失败跳过该档。
 * ⚠️ 只拼 avc1(vp9/av1 webm 浏览器 MSE 播不了)+ AAC(mp4a.40.2)。
 */
async function youtubeDashStreams(
  adaptive: PlayerFormat[],
  duration: number,
  headers: Record<string, string>,
  videoId: string,
): Promise<Stream[]> {
  // 1. 视频轨:filter(avc + Range) → 逐个解 URL(失败跳过)。
  const videos: Array<{ f: PlayerFormat; url: string }> = []
  for (const f of R.filter(isAvcVideo, adaptive)) {
    const url = await resolveFormatUrl(f, videoId)
    if (url) videos.push({ f, url })
  }
  if (!videos.length) return []

  // 2. 音轨:filter(aac + Range) → 取最高码率一档(140/141 皆可,139 低码率被排掉)。
  const audios = R.filter(isAacAudio, adaptive)
  const audio = R.last<PlayerFormat>(R.sortBy((a) => Number(a.bitrate ?? 0), audios))
  const audioUrl = audio ? await resolveFormatUrl(audio, videoId) : null
  const audioRep: MpdAudioRep | undefined =
    audio && audioUrl
      ? {
          id: audio.itag,
          baseUrl: audioUrl,
          codecs: codecsFromMime(audio.mimeType) ?? "mp4a.40.2",
          bandwidth: Number(audio.bitrate ?? 0),
          initRange: `${audio.initRange!.start}-${audio.initRange!.end}`,
          indexRange: `${audio.indexRange!.start}-${audio.indexRange!.end}`,
        }
      : undefined

  // 3. 按 height 降序(默认选流 = streams[0] = 最高档)。
  const sorted = R.sortBy((v: { f: PlayerFormat }) => Number(v.f.height ?? 0), videos)
  const desc = R.reverse(sorted)

  // 4. 每档 map 成 Stream:MPD 只含该档 video + 公共音轨。
  return R.map(
    ({ f, url }: { f: PlayerFormat; url: string }): Stream => {
      const rep: MpdVideoRep = {
        id: f.itag,
        baseUrl: url,
        width: Number(f.width ?? 0),
        height: Number(f.height ?? 0),
        codecs: codecsFromMime(f.mimeType) ?? "avc1.640033",
        bandwidth: Number(f.bitrate ?? 0),
        initRange: `${f.initRange!.start}-${f.initRange!.end}`,
        indexRange: `${f.indexRange!.start}-${f.indexRange!.end}`,
      }
      const height = Number(f.height ?? 0)
      return {
        url: "",
        format: "dash",
        headers,
        quality: f.qualityLabel ?? `${height}p`,
        rate: height,
        dashManifest: buildMpd({ videos: [rep], audio: audioRep, duration, minBufferTime: 1.5 }),
      }
    },
    desc,
  )
}

/** 搜频道的命中(channelId = `youtube` 渠道的订阅参数)。 */
export interface YoutubeChannelHit {
  channelId: string
  title: string
  thumb?: string
  /** 订阅数文本(如 "12.3M subscribers")。 */
  subsText?: string
  videoCountText?: string
}

/** InnerTube 文本节点:simpleText 优先,runs 拼接兜底。 */
function ytText(node: unknown): string | undefined {
  const n = node as { simpleText?: unknown; runs?: Array<{ text?: unknown }> }
  if (typeof n?.simpleText === "string") return n.simpleText
  if (Array.isArray(n?.runs)) {
    const joined = n.runs.map((r) => String(r?.text ?? "")).join("")
    return joined || undefined
  }
  return undefined
}

/** 缩略图节点:取 width 最大的那张。 */
function ytThumb(node: unknown): string | undefined {
  const list = (node as { thumbnails?: Array<{ url?: unknown; width?: unknown }> })?.thumbnails
  if (!Array.isArray(list) || !list.length) return undefined
  let best = list[0]!
  for (const t of list) if (Number(t.width ?? 0) > Number(best.width ?? 0)) best = t
  return typeof best.url === "string" ? best.url : undefined
}

/**
 * 搜频道(InnerTube search;`params:"EgIQAg=="` 是 protobuf 过滤器 = 只返回频道,
 * 实测匿名 20 条)。与 player 同一套 client context(WEB + visitorData);
 * channelRenderer 平铺在 sectionList 的两层 contents 里,逐层收集。
 */
export async function searchYouTubeChannels(keyword: string): Promise<YoutubeChannelHit[]> {
  const visitorData = await getVisitorData()
  const res = (await postJson(
    `${YOUTUBEI_V1}/search?prettyPrint=false`,
    {
      context: {
        client: { clientName: "WEB", clientVersion: WEB_CLIENT_VERSION, hl: "en", gl: "US", visitorData },
      },
      query: keyword,
      params: "EgIQAg==",
    },
    { "user-agent": WEB_UA },
  )) as Record<string, any>
  const sections =
    res?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents ?? []
  const out: YoutubeChannelHit[] = []
  for (const sec of sections) {
    const items = sec?.itemSectionRenderer?.contents ?? []
    for (const it of items) {
      const r = it?.channelRenderer
      const channelId = String(r?.channelId ?? "")
      if (!channelId) continue
      out.push({
        channelId,
        title: ytText(r?.title) ?? channelId,
        thumb: ytThumb(r?.thumbnail),
        subsText: ytText(r?.subscriberCountText),
        videoCountText: ytText(r?.videoCountText),
      })
    }
  }
  return out
}

/** 直播搜索命中(videoId = `youtube:live` 的订阅参数)。 */
export interface YoutubeLiveHit {
  videoId: string
  title: string
  channelTitle?: string
  thumb?: string
  /** 观看数(解析 "1,234 watching";"Waiting" 等非数字返回 undefined)。 */
  viewers?: number
}

/**
 * 搜正在直播的视频(InnerTube search + `params:"EgJAAQ=="`)。
 *
 * `EgJAAQ==` 是 protobuf 过滤器:外层 field 2 包一个 field 8 = 1(直播)。
 * 实测匿名返回 18~20 条、全部带 LIVE badge,无分页(取首页)。
 * 与 searchYouTubeChannels 同一套 WEB client context。
 */
export async function searchYouTubeLive(keyword: string): Promise<YoutubeLiveHit[]> {
  const visitorData = await getVisitorData()
  const res = (await postJson(
    `${YOUTUBEI_V1}/search?prettyPrint=false`,
    {
      context: {
        client: { clientName: "WEB", clientVersion: WEB_CLIENT_VERSION, hl: "en", gl: "US", visitorData },
      },
      query: keyword,
      params: "EgJAAQ==",
    },
    { "user-agent": WEB_UA },
  )) as Record<string, any>
  const sections =
    res?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents ?? []
  const out: YoutubeLiveHit[] = []
  for (const sec of sections) {
    for (const it of sec?.itemSectionRenderer?.contents ?? []) {
      const r = it?.videoRenderer
      const videoId = String(r?.videoId ?? "")
      if (!videoId) continue
      // "1,234 watching" → 1234;直播搜索里还有 "Waiting"/"Upcoming" 等文案。
      const viewersText = ytText(r?.viewCountText)
      const viewers = viewersText ? Number(viewersText.replace(/[^\d]/g, "")) || undefined : undefined
      out.push({
        videoId,
        title: ytText(r?.title) ?? videoId,
        channelTitle: ytText(r?.ownerText) ?? ytText(r?.longBylineText),
        thumb: ytThumb(r?.thumbnail),
        viewers,
      })
    }
  }
  return out
}

/** 组装最终 Stream[](带 referer/UA header,浏览器原生 <video> 能播 mp4)。 */
export async function resolveYoutubeStreams(videoId: string): Promise<Stream[]> {
  const visitorData = await getVisitorData()

  // 1. VISIONOS(主力,免 POT)→ 2. ANDROID_VR(退役中,仍可用)→ 3. WEB(最后兜底)。
  // ⚠️ WEB 2026 起只给 SABR,`adaptiveFormats` 为空,放最后只是为了让错误信息更具体。
  //    五条视频同批复测:VISIONOS 与 VR 的 status / 最高档完全一致,故按上游默认排 VISIONOS 先。
  let lastErr: unknown
  const attempt = async (fn: () => Promise<PlayerResponse>): Promise<PlayerResponse | null> => {
    try {
      const r = await fn()
      checkPlayability(r, videoId)
      return r
    } catch (e) {
      lastErr = e
      return null
    }
  }
  const res =
    (await attempt(() => getVisionosPlayerResponse(videoId, visitorData))) ??
    (await attempt(() => getAndroidPlayerResponse(videoId, visitorData))) ??
    (await attempt(() => getWebPlayerResponse(videoId, visitorData)))
  if (!res) {
    throw lastErr instanceof Error ? lastErr : new Error(`YouTube 无法获取 playerResponse: ${videoId}`)
  }

  // 直播:ANDROID_VR 自带 hlsManifestUrl(实测确认)。若没有(部分直播形态),
  // fallback iOS client(ANDROID 系不返回 hls 时才需要)。
  if (isLiveContent(res)) {
    const hls = res.streamingData?.hlsManifestUrl
    if (hls) return [{ url: hls, format: "hls", headers: { referer: "https://www.youtube.com/", "user-agent": IOS_UA } }]
    try {
      const ios = await getIosPlayerResponse(videoId, visitorData)
      checkPlayability(ios, videoId)
      const iosHls = ios.streamingData?.hlsManifestUrl
      if (iosHls) return [{ url: iosHls, format: "hls", headers: { referer: "https://www.youtube.com/", "user-agent": IOS_UA } }]
    } catch (e) {
      log.youtube.warn("iOS live 请求失败:", formatError(e))
    }
    // iOS 也拿不到 HLS,回退 ANDROID_VR/WEB 的 formats(若有)。
  }

  // 非直播(或 live 但 VR/iOS 都无 HLS):DASH 优先(1080p+ 有声)。
  // ⚠️ 渐进式(360p)不混进返回数组——MediaPlayer 默认选流 `find(isProgressiveVideo)`
  //   会优先渐进式,混排会导致默认落 360p。DASH 装配失败才整体 fallback 渐进式。
  const headers = { referer: "https://www.youtube.com/", "user-agent": WEB_UA }
  const adaptive = res.streamingData?.adaptiveFormats ?? []
  const duration = Number(res.videoDetails?.lengthSeconds ?? 0)
  const dash = await youtubeDashStreams(adaptive, duration, headers, videoId)
  if (dash.length) return dash

  // DASH 装配失败(无 avc1 / 无 URL / 无 Range)→ 渐进式 mp4 一档。
  const formats = res.streamingData?.formats ?? []
  const best = pickProgressiveVideo(formats)
  if (best) {
    const url = await resolveFormatUrl(best, videoId)
    if (url) return [{ url, format: "mp4", headers }]
  }

  // 渐进式拿不到 → 试 HLS manifest(直播)。
  const hls = res.streamingData?.hlsManifestUrl
  if (hls) return [{ url: hls, format: "hls", headers: { referer: "https://www.youtube.com/" } }]

  throw new Error(`YouTube 未找到可播直链: https://www.youtube.com/watch?v=${videoId}`)
}

/** 无状态 youtube 客户端:弹幕流能力(live chat 轮询)。播放流走 resolveYoutubeStreams 函数。 */
export const youtubeClient = {
  /** 直播弹幕(InnerTube continuation 轮询,非 WS)。播放流走 resolveYoutubeStreams。 */
  getDanmaku: (roomId: string) => createLiveChatPoller(roomId),
} satisfies PlatformClient
