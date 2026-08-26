/**
 * BilibiliClient — crawler 版 bili 共享客户端(HTTP + wbi 签名 + buvid)。
 *
 * **模块级单例 `biliClient`**(对齐其余 6 平台的无状态单例形态):cookie/referer/
 * buvid 每次请求经 opts 传入,无构造器状态。共享状态按语义缓存:
 *   - nav(wbi 密钥 + 登录 mid)**按 cookie 分 key**——不同登录态 mid 不同,共享会串味;
 *   - 匿名 buvid3/4 指纹模块级一次(与 cookie 无关)。
 *
 * 两套签名语义分开(web 直播不同,不可合并):
 *   - signWeb     web 端:URLSearchParams sort → md5(串&wts+key),输出 `...&w_rid&wts`
 *   - signLiveParams 直播端:record sort → strip `!'()*` → encode join → md5(query+key),wts 参与排序,无独立 wts
 *
 * 零登录:nav 未登录(`code:-101`)仍返回 wbi_img → MD5 即可签名。
 */
import * as R from "ramda"
import type { Stream } from "@tauri-playground/xml"
import { log } from "../../log.ts"
import { httpJson, now } from "../../host.ts"
import { md5Hex } from "../../utils/md5.ts"
import { buildMpd, type MpdAudioRep, type MpdVideoRep } from "../../utils/mpd.ts"
import { strOr } from "../../utils/str.ts"
import { DESKTOP_CHROME_UA } from "../../utils/ua.ts"
import type { PlatformClient, PlatformRequestOptions } from "../types.ts"
import type { DanmakuOptions, DanmakuStream } from "../../danmaku"
import { biliLiveDanmakuStream } from "./danmaku-live.ts"
import { biliVodDanmakuStream } from "./danmaku-vod.ts"


export const BILIBILI_UA = DESKTOP_CHROME_UA

const API_MAIN = "https://api.bilibili.com"
const DEFAULT_REFERER = "https://www.bilibili.com/"

export const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42,
  19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51,
  30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
]

/**
 * bili 弹幕选项:共享 cookie + 平台私有 vod/live 判别(bili 视频全量 / 直播实时流)。
 * kind 是 bili 特有的分发维度,不污染共享 DanmakuOptions(其余平台 getDanmaku 不吃 opts)。
 */
export interface BilibiliDanmakuOptions extends DanmakuOptions {
  kind?: "live" | "vod"
}

export interface BilibiliClient extends PlatformClient {
  /** GET JSON,统一 UA/status/code 检查;opts.cookie 显式覆盖,opts.buvid 时补匿名指纹,opts.referer 覆盖默认。 */
  getJson<T = Record<string, any>>(url: string, opts?: PlatformRequestOptions & { allowCodeError?: boolean; buvid?: boolean }): Promise<T>
  /** web 签名:`...&w_rid&wts`(wbi key 取自 cookie 对应 nav;匿名同 key)。 */
  signWeb(query: string, cookie?: string): Promise<string>
  /** 直播签名(无独立 wts=;wts 内联排序)。 */
  signLiveParams(params: Record<string, string>, cookie?: string): Promise<string>
  /** 确保匿名 buvid3/4 就绪(模块级一次,幂等)。 */
  ensureBuvid(): Promise<void>
  /** 登录态 mid(nav 响应;未登录/无 cookie 为 0)。直播弹幕认证用,与 signWeb 复用同一 nav。 */
  navMid(cookie?: string): Promise<number>
  /** bvid/aid → 默认分 P 的 cid(/x/web-interface/view,非 wbi 接口)。 */
  resolveCid(bvidOrAid: string, cookie?: string): Promise<string>
  /** bvid+cid → durl mp4 直链(/x/player/playurl,qn=80 platform=html5)。 */
  resolvePlayUrl(bvidOrAid: string, cid: string, cookie?: string): Promise<Stream[]>
  /** 弹幕能力:kind=vod 走视频全量解析(VOD 时间轴),默认 live 走直播实时流。 */
  getDanmaku(id: string, opts?: BilibiliDanmakuOptions): DanmakuStream
}

// ── 模块级共享状态(nav 按 cookie 分 key;匿名 buvid 一次)───────────────────────

const navCache = new Map<string, Promise<Record<string, any>>>() // key = cookie 串("" = 匿名)
let buvidPromise: Promise<void> | null = null
let anonBuvid = "" // "buvid3=..;buvid4=..;" 匿名指纹

/** 一次 nav(带 cookie 取登录态 mid + wbi_img)。按 cookie 缓存——不同登录态 mid 不同,不能共享。 */
function getNavData(cookie?: string): Promise<Record<string, any>> {
  const key = cookie ?? ""
  let p = navCache.get(key)
  if (!p) {
    // nav 不走 getJson(nav 合法返回 code:-101)
    p = httpJson<Record<string, any>>(`${API_MAIN}/x/web-interface/nav`, {
      "user-agent": BILIBILI_UA,
      referer: DEFAULT_REFERER,
      ...(cookie ? { cookie } : {}),
    })
    navCache.set(key, p)
  }
  return p
}

/** 登录态 mid(nav 响应;未登录/无 cookie 返回 0)。直播弹幕认证用。 */
async function navMid(cookie?: string): Promise<number> {
  const data = await getNavData(cookie)
  return Number(data?.data?.mid ?? 0)
}

async function getMixinKey(cookie?: string): Promise<string> {
  const data = await getNavData(cookie)
  const img = data?.data?.wbi_img
  const imgKey = fileStem(strOr(img?.img_url) ?? "")
  const subKey = fileStem(strOr(img?.sub_url) ?? "")
  if (!imgKey || !subKey) throw new Error("bilibili nav returned no wbi_img (signing unavailable)")
  const origin = imgKey + subKey
  let s = ""
  for (const i of MIXIN_KEY_ENC_TAB) s += origin[i] ?? ""
  return s.slice(0, 32)
}

/** 匿名 buvid3/4 指纹(与 cookie 无关,模块级一次)。 */
async function ensureBuvid(): Promise<void> {
  if (anonBuvid) return
  if (!buvidPromise) {
    buvidPromise = (async () => {
      const parsed = await httpJson<Record<string, any>>(`${API_MAIN}/x/frontend/finger/spi`, {
        "user-agent": BILIBILI_UA,
        referer: DEFAULT_REFERER,
      })
      const b3 = strOr(parsed?.data?.b_3) ?? ""
      const b4 = strOr(parsed?.data?.b_4) ?? ""
      anonBuvid = b3 ? `buvid3=${b3};buvid4=${b4};` : ""
    })()
  }
  await buvidPromise
}

async function signWeb(query: string, cookie?: string): Promise<string> {
  const key = await getMixinKey(cookie)
  const sp = new URLSearchParams(query)
  sp.sort()
  const wts = Math.floor(now() / 1000).toString()
  const wRid = md5Hex(`${sp.toString()}&wts=${wts}${key}`)
  return `${query}${query ? "&" : ""}w_rid=${wRid}&wts=${wts}`
}

async function signLiveParams(params: Record<string, string>, cookie?: string): Promise<string> {
  const key = await getMixinKey(cookie)
  const wts = Math.floor(now() / 1000).toString()
  const all: Record<string, string> = { ...params, wts }
  const sorted = Object.keys(all).sort()
  const filtered: Record<string, string> = {}
  for (const k of sorted) filtered[k] = (all[k] ?? "").replace(/[!'()*]/g, "")
  const query = sorted.map((k) => `${k}=${encodeURIComponent(filtered[k] ?? "")}`).join("&")
  const wRid = md5Hex(`${query}${key}`)
  return `${query}&w_rid=${wRid}`
}

async function getJson<T = Record<string, any>>(
  url: string,
  opts: PlatformRequestOptions & { allowCodeError?: boolean; buvid?: boolean } = {},
): Promise<T> {
  const extra: Record<string, string> = { ...opts.headers }
  // opts.cookie 显式覆盖;opts.buvid 时补匿名指纹(space/直播 API 需要)。
  if (opts.cookie && !extra.cookie) {
    extra.cookie = opts.cookie
  } else if (opts.buvid && !extra.cookie) {
    await ensureBuvid()
    if (anonBuvid) extra.cookie = anonBuvid
  }
  const data = await httpJson<Record<string, any>>(url, {
    "user-agent": BILIBILI_UA,
    referer: opts.referer ?? DEFAULT_REFERER,
    ...extra,
  })
  if (data?.code !== undefined && data.code !== 0 && !opts.allowCodeError) {
    throw new Error(`bilibili API ${data.code}: ${data.message ?? "unknown error"}`)
  }
  return data as T
}

/**
 * bvid/aid → 默认分 P 的 cid。复用 /x/web-interface/view(非 wbi,无需签名)。
 * 多 P 视频默认取第一 P(data.cid);需要多 P 列表可后续扩展 pages。
 */
async function resolveCid(bvidOrAid: string, cookie?: string): Promise<string> {
  const q = bvidOrAid.startsWith("av") ? `aid=${bvidOrAid.slice(2)}` : `bvid=${encodeURIComponent(bvidOrAid)}`
  const video = `${API_MAIN}/x/web-interface/view?${q}`
  const res = await getJson<{ data?: { cid?: number } }>(video, {
    referer: `https://www.bilibili.com/video/${bvidOrAid}`,
    cookie,
  })
  const cid = res?.data?.cid
  if (!cid) throw new Error(`bilibili view: no cid for ${bvidOrAid}`)
  return String(cid)
}

/**
 * bvid+cid → 全档位可播流(/x/player/playurl,platform=pc,fnval=16)。
 * 档位动态获取:accept_quality(qn 数组)+ accept_description(中文名),服务端按登录态裁。
 * 流来源:
 *   - DASH(fnval=16):音视频分离(video+audio 两轨),crawler 拼成 MPD 存
 *     stream.dashManifest,`format:"dash"` 由 dash.js 双 SourceBuffer 合成播放
 *     (等价 B 站官方 MSE 路径)——解锁 1080P + 声音。
 *   - durl 渐进式 mp4(无 fnval):音视频混合,原生 `<video>` 播。最高 720P。
 * 优先 DASH(更高画质 + 有声);DASH 不可用时回退 durl。
 * URL 带 deadline 签名,须在播放时调用(懒解析),不缓存。
 */
async function resolvePlayUrl(bvidOrAid: string, cid: string, cookie?: string): Promise<Stream[]> {
  const id = bvidOrAid.startsWith("av") ? `av${bvidOrAid.slice(2)}` : bvidOrAid
  const referer = `https://www.bilibili.com/video/${bvidOrAid}`
  const headers = { referer, "user-agent": BILIBILI_UA }
  const base = `${API_MAIN}/x/player/playurl?bvid=${encodeURIComponent(id)}&cid=${cid}&platform=pc`

  // 1. fnval=16 拿 DASH(音视频分离,拼 MPD)。登录后 avc 有 1080P(非会员也)。
  const dashProbe = await getJson<{ data?: Record<string, any> }>(`${base}&qn=116&fnval=16`, { referer, cookie })
  const dashStreams = dashStreamsWithMpd(dashProbe?.data ?? {}, headers)

  // 2. durl 渐进式 mp4(音视频混合,最高 720P)。逐档重发。
  const durlStreams: Stream[] = []
  const durlProbe = await getJson<{ data?: Record<string, any> }>(`${base}&qn=80`, { referer, cookie })
  const dd = durlProbe?.data ?? {}
  const acceptQuality: unknown[] = Array.isArray(dd.accept_quality) ? dd.accept_quality : []
  const acceptDesc: unknown[] = Array.isArray(dd.accept_description) ? dd.accept_description : []
  const qualities = acceptQuality
    .map((qn, i) => ({ qn: Number(qn), name: String(acceptDesc[i] ?? `档位${qn}`) }))
    .filter((q) => Number.isFinite(q.qn) && q.qn > 0)
  for (const [idx, q] of qualities.entries()) {
    try {
      const r = await getJson<{ data?: { durl?: Array<{ url?: string }> } }>(`${base}&qn=${q.qn}`, { referer, cookie })
      const durl: Array<{ url?: string }> = Array.isArray(r?.data?.durl) ? r.data.durl : []
      const first = durl.find((d) => d.url)
      if (first?.url) durlStreams.push({ url: first.url, format: "mp4", headers, quality: q.name, rate: q.qn })
    } catch (e) {
      if (idx === 0) throw e
      log.bili.warn(`视频档位 ${q.name}(qn=${q.qn}) 解析失败,跳过:`, (e as Error)?.message)
    }
  }
  if (!durlStreams.length) {
    const r = await getJson<{ data?: { durl?: Array<{ url?: string }> } }>(`${base}&qn=80`, { referer, cookie })
    const durl: Array<{ url?: string }> = Array.isArray(r?.data?.durl) ? r.data.durl : []
    const first = durl.find((d) => d.url)
    if (first?.url) durlStreams.push({ url: first.url, format: "mp4", headers })
  }

  // 3. DASH 优先(1080P + 有声);DASH 构造失败回退 durl。两者均已按 rate 降序
  //    (契约:最高清晰度排最前,player 默认选流取第一个)。
  if (dashStreams.length) return dashStreams
  if (durlStreams.length) return R.sortWith([R.descend((s: Stream) => s.rate ?? 0)], durlStreams)
  throw new Error(`bilibili playurl: no playable stream for ${bvidOrAid}`)
}

/** 弹幕能力:kind=vod 走视频全量解析,否则直播实时流。cookie 由 opts 显式传。 */
function getDanmaku(id: string, opts?: BilibiliDanmakuOptions): DanmakuStream {
  return opts?.kind === "vod" ? biliVodDanmakuStream(id, opts?.cookie) : biliLiveDanmakuStream(id, opts?.cookie)
}

/** 模块级单例(对齐其余 6 平台)。cookie/referer/buvid 每次请求经 opts 传。 */
export const biliClient: BilibiliClient = {
  getJson,
  signWeb,
  signLiveParams,
  ensureBuvid,
  navMid,
  resolveCid,
  resolvePlayUrl,
  getDanmaku,
}

function fileStem(url: string): string {
  return url.split("/").pop()?.split(".")[0] ?? ""
}

/**
 * 从 fnval=16 playurl 响应构造 DASH 全档位流。
 * B 站 DASH 音视频分离:`dash.video[]`(视频轨,登录后有 1080P avc)+ `dash.audio[]`
 * (AAC 音轨)。单个原生 `<video src>` 播不了双轨 → 把两轨构造成 DASH MPD XML,
 * 存 stream.dashManifest,由 dash.js 双 SourceBuffer 合成播放(等价 B 站官方 MSE 路径)。
 *
 * 每档 video 一个 Stream(`format:"dash"`,带完整 MPD),档位名用 accept_description
 * 匹配 dash.video[i].id(qn)。只保留 H.264 avc 视频轨(hevc 浏览器 MSE 播不了)与
 * AAC 音轨(mp4a.40.2)。audio 只取最高码率一档(音质不影响档位切换)。
 *
 * ⚠️ B 站分片是裸 fMP4(无现成 MPD)——SegmentBase.Initialization/indexRange 描述
 * init 段与 index 段,拼进 MPD 的 Representation 供 dash.js 做 Range 拉取。
 */
function dashStreamsWithMpd(data: Record<string, any>, headers: Record<string, string>): Stream[] {
  const acceptDesc = R.pathOr<unknown[]>([], ["accept_description"], data)
  const acceptQuality = R.pathOr<unknown[]>([], ["accept_quality"], data)
  // qn → 档位中文名(accept_quality/accept_description 同索引)。
  const nameOf = (qn: number): string => {
    const i = R.findIndex((q: unknown) => Number(q) === qn, acceptQuality)
    return i >= 0 ? String(acceptDesc[i] ?? `档位${qn}`) : `档位${qn}`
  }
  const dash = R.pathOr<Record<string, any>>({}, ["dash"], data)
  const videos = R.pathOr<Record<string, any>[]>([], ["video"], dash)
  const audios = R.pathOr<Record<string, any>[]>([], ["audio"], dash)

  // 音轨:取最高码率一档(AAC)。无音轨(纯音乐视频等)→ MPD 不含 audio,视频无声。
  // sortBy 升序后取 last(带宽最大);显式参数避免 pipe 的类型流卡成 unknown。
  const audio = R.last<Record<string, any>>(R.sortBy((a: Record<string, any>) => Number(a?.bandwidth ?? 0), audios))

  const duration = Number(dash.duration ?? 0)
  const minBufferTime = Number(dash.minBufferTime ?? 1.5)

  // filter(可播 avc) → map(每档一条带 MPD 的 Stream)。for/continue/push 消掉。
  return R.pipe(
    R.filter(
      (v: Record<string, any>) => !!v?.baseUrl && /avc1|avc/i.test(String(v?.codecs ?? "")),
    ),
    R.map((v: Record<string, any>): Stream => {
      const qn = Number(v?.id ?? 0)
      // 每档 MPD **只含该档 Representation**(+公共音轨)——dash.js 无档可选,
      // 天然锁目标档,不会 ABR 降档。切档时 resolvePlay 返回对应档的 MPD。
      return {
        url: "",
        format: "dash",
        headers,
        quality: nameOf(qn),
        rate: qn,
        dashManifest: buildMpd({
          videos: [toVideoRep(v)],
          audio: audio ? toAudioRep(audio) : undefined,
          duration,
          minBufferTime,
        }),
      }
    }),
    // 契约:最高清晰度排最前(player 默认选流取第一个)。dash.video[] 是服务端
    // 原始顺序(不保证 qn 降序),显式按 rate 降序。
    R.sortWith([R.descend((s: Stream) => s.rate ?? 0)]),
  )(videos)
}

/** dash.video[i] → MpdVideoRep(归一化 SegmentBase 字段)。 */
function toVideoRep(v: Record<string, any>): MpdVideoRep {
  return {
    id: Number(v?.id ?? 0),
    baseUrl: String(v?.baseUrl ?? ""),
    width: Number(v?.width ?? 0),
    height: Number(v?.height ?? 0),
    codecs: String(v?.codecs ?? "avc1.640033"),
    bandwidth: Number(v?.bandwidth ?? 0),
    initRange: String(v?.SegmentBase?.Initialization ?? v?.segment_base?.Initialization ?? "0-915"),
    indexRange: String(v?.SegmentBase?.indexRange ?? v?.segment_base?.indexRange ?? "916-2503"),
  }
}

/** dash.audio[i] → MpdAudioRep(归一化 SegmentBase 字段)。 */
function toAudioRep(a: Record<string, any>): MpdAudioRep {
  return {
    id: Number(a?.id ?? 0),
    baseUrl: String(a?.baseUrl ?? ""),
    codecs: String(a?.codecs ?? "mp4a.40.2"),
    bandwidth: Number(a?.bandwidth ?? 0),
    initRange: String(a?.SegmentBase?.Initialization ?? a?.segment_base?.Initialization ?? "0-836"),
    indexRange: String(a?.SegmentBase?.indexRange ?? a?.segment_base?.indexRange ?? "837-2400"),
  }
}
