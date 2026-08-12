/**
 * bili:live —— bilibili 直播房间 channel。
 *
 * 复刻 producer 的 BilibiliSite.getRoomDetail(wbi 签名 + buvid cookie),
 * 产单个 Live Item(状态 + 元数据,不含 playUrls——懒解析)。
 * 零登录:wbi 签名 + buvid finger cookie。
 */
import * as R from "ramda"
import type { Item, Live, Stream } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { LivePlayable, RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch } from "../factory.ts"
import { now } from "../../host.ts"
import { log } from "../../log.ts"
import { BILIBILI_UA, createBilibiliClient } from "./client.ts"


const API_LIVE = "https://api.live.bilibili.com"

export class BiliLiveChannel implements RssChannel {
  readonly key = "bili:live"
  readonly name = "bilibili 直播房间"
  readonly kind = "live" as const
  readonly sourceInfoTpl = [
    { key: "roomId", label: "直播间 ID", required: true },
    {
      key: "cookie",
      label: "登录 cookie(可选)",
      required: false,
      // 提示:从浏览器 bilibili.com 已登录页面复制完整 cookie 串,解锁登录档位(非大会员 1080p)。
    },
  ]
  // 直播源:implements LivePlayable,resolveLivePlay 按订阅 info 传 cookie(登录态档位)。
  getSource(info: SourceInfo): RssSource & LivePlayable {
    return {
      fetch: apiFetch(() => this.fetchItems(info), () => this.channelOptions(info)),
      resolveLivePlay: (roomId) => resolveBiliLivePlay(roomId, info),
    }
  }

  private async fetchItems(info: SourceInfo): Promise<Item[]> {
    const roomId = info.roomId ?? ""
    if (!roomId) throw new Error("bili:live 需要 roomId")
    const client = createBilibiliClient({
      referer: "https://live.bilibili.com/",
      buvid: true,
      live: true,
      cookie: info.cookie || undefined,
    })
    const params = await client.signLiveParams({ room_id: roomId })
    const res = await client.getJson<{ data?: Record<string, unknown> }>(`${API_LIVE}/xlive/web-room/v1/index/getInfoByRoom?${params}`)
    const ri = (res?.data?.["room_info"] ?? {}) as Record<string, unknown>
    const realRoomId = String(ri["room_id"] ?? roomId)
    const t = now()
    const live: Live = {
      id: `bilibili:${realRoomId}`,
      sourceId: "bili:live",
      kind: "live",
      title: String(ri["title"] ?? ""),
      url: `https://live.bilibili.com/${realRoomId}`,
      thumbnail: String(ri["cover"] ?? ""),
      author: { name: String(ri["uname"] ?? "") },
      fetchedAt: t,
      platform: "bilibili",
      roomId: realRoomId,
      liveStatus: Number(ri["live_status"]) === 1 ? "live" : "offline",
      online: Number(ri["online"] ?? 0),
      introduction: ri["description"] ? String(ri["description"]) : undefined,
      showTime: ri["live_start_time"] ? String(ri["live_start_time"]) : undefined,
    }
    return [live]
  }
  private channelOptions(info: SourceInfo): SerializeOptions {
    return { channelTitle: `bilibili 直播 ${info.roomId ?? ""}`, channelLink: `https://live.bilibili.com/${info.roomId ?? ""}` }
  }
}

/**
 * 懒解析 bilibili 直播流,返回**全档位**(动态获取,非硬编码):
 *   1. 首请求 getRoomPlayInfo(qn=10000)→ 读 g_qn_desc(qn→名称) + 首 codec 的
 *      accept_qn(本房间/本登录态可用的档位列表,服务端动态);
 *   2. 逐档重发 getRoomPlayInfo(qn=档位值)→ hls/flv 直链,每档带 quality+rate。
 * 档位随房间/登录态动态变化(未登录钳到 250 超清、登录后 10000 原画;不同房间 accept_qn 不同)。
 * 独立纯函数(不依赖 channel 实例),由 factory 装配进 source。
 *
 * 登录态:订阅 info 带 cookie(浏览器复制的完整串,含 SESSDATA)时解锁登录档位,
 * 未带 cookie 则零登录(原画/超清封顶)。
 */
async function resolveBiliLivePlay(roomId: string, info?: SourceInfo): Promise<Stream[]> {
  const client = createBilibiliClient({
    referer: "https://live.bilibili.com/",
    buvid: true,
    live: true,
    cookie: (info?.cookie as string) || undefined,
  })
  // 参数复刻 dart bilibili_site.dart:129(getPlayQualites,首请求全 format/codec 探测)。
  const baseParams: Record<string, string> = {
    room_id: roomId,
    protocol: "0,1",
    format: "0,1,2",
    codec: "0,1",
    platform: "web",
  }
  // 1. 首请求拿档位列表(g_qn_desc + accept_qn)。
  const probeParams = await client.signLiveParams({ ...baseParams, qn: "10000" })
  const probe = await client.getJson<{ data?: Record<string, any> }>(
    `${API_LIVE}/xlive/web-room/v2/index/getRoomPlayInfo?${probeParams}`,
  )
  const qualities = extractBiliLiveQualities(probe?.data ?? {})
  if (!qualities.length) return resolveBiliLiveProbe(probe?.data ?? {}, roomId)

  // 2. 逐档重发拿直链。首档(默认档)失败整体报错;其余档失败跳过。
  const streams: Stream[] = []
  for (const [idx, q] of qualities.entries()) {
    try {
      // 取流参数复刻 dart getPlayUrls(bilibili_site.dart:164):format:0,2 + codec:0(只要 avc,不拉 hevc)。
      const p = await client.signLiveParams({
        ...baseParams,
        format: "0,2",
        codec: "0",
        qn: String(q.qn),
      })
      const r = await client.getJson<{ data?: Record<string, any> }>(
        `${API_LIVE}/xlive/web-room/v2/index/getRoomPlayInfo?${p}`,
      )
      const list = parseBiliLiveStreams(r?.data ?? {})
      const s = list[0]
      if (s) streams.push({ ...s, quality: q.name, rate: q.qn })
    } catch (e) {
      if (idx === 0) throw e
      log.biliLive.warn(`档位 ${q.name}(qn=${q.qn}) 解析失败,跳过:`, (e as Error)?.message)
    }
  }
  if (!streams.length) return resolveBiliLiveProbe(probe?.data ?? {}, roomId)
  // 契约:最高清晰度排最前(player 默认选流取第一个)。accept_qn 顺序不保证高→低,显式降序。
  return R.sortWith([R.descend((s: Stream) => s.rate ?? 0)], streams)
}

/**
 * 从 getRoomPlayInfo 响应提取档位列表(动态)。
 * g_qn_desc:[{qn, desc}] 是 qn→中文名全表;stream[0].format[0].codec[0].accept_qn
 * 是本房间当前可用档位(服务端按房间/登录态裁)。按 accept_qn 顺序返回(qn 值 + 名称)。
 */
function extractBiliLiveQualities(data: Record<string, any>): Array<{ qn: number; name: string }> {
  const playurl = (data?.playurl_info?.playurl ?? {}) as Record<string, any>
  const qnDesc = (Array.isArray(playurl?.g_qn_desc) ? playurl.g_qn_desc : []) as Array<Record<string, any>>
  const codec = (playurl?.stream?.[0]?.format?.[0]?.codec?.[0] ?? {}) as Record<string, any>
  const acceptQn = Array.isArray(codec?.accept_qn) ? (codec.accept_qn as unknown[]) : []
  return acceptQn
    .map((qn) => {
      const n = Number(qn)
      const desc = qnDesc.find((g) => Number(g?.qn) === n)?.desc
      return { qn: n, name: desc ? String(desc) : `档位${n}` }
    })
    .filter((q) => Number.isFinite(q.qn) && q.qn > 0)
}

/** 一条可播流 URL(codec.url_info 展开后)。 */
interface BiliLiveUrl {
  url: string
  format: string
  host: string
}

/** 取嵌套数组字段,缺省空数组(pathOr 提供类型化默认,免 Array.isArray 样板)。 */
const pathArr = (path: string[]) => (obj: Record<string, any>): Record<string, any>[] =>
  R.pathOr<Record<string, any>[]>([], path, obj)

/**
 * 从单个 codec 展开 url_info 列表。
 * **只保留 avc(H.264)流** —— HEVC(minihevc)flv.js/hls.js 都播不了(编码不支持)。
 * format 由 base_url 后缀推断:.m3u8 和 .fmp4 都是 HLS(fmp4 用 hls.js 可播),.flv 是 HTTP-FLV。
 * host 空的 url_info 跳过。
 */
function codecToUrls(c: Record<string, any>): BiliLiveUrl[] {
  if (String(c?.codec_name ?? "").toLowerCase() !== "avc") return []
  const baseUrl = String(c?.base_url ?? "")
  if (!baseUrl) return []
  const format = baseUrl.includes(".m3u8") || baseUrl.includes(".fmp4") ? "hls" : baseUrl.includes(".flv") ? "flv" : "live"
  return R.chain(
    (ui: Record<string, any>) => {
      const host = String(ui?.host ?? "")
      const extra = String(ui?.extra ?? "")
      return host ? [{ url: `${host}${baseUrl}${extra}`, format, host }] : []
    },
    pathArr(["url_info"])(c),
  )
}

/**
 * 从 getRoomPlayInfo 响应提取可播流(函数式)。
 * 结构:data.playurl_info.playurl.stream[] → format[] → codec[],每个 codec 有
 * codec_name(avc=H.264 / hevc=HEVC)、base_url + url_info[](host + extra)。
 *
 * 三层 chain 展开(stream→format→codec→url_info,等价原嵌套 for),sortWith 显式双键排序:
 *   hls(fmp4)优先(对直播延迟/兼容更好) → mcdn/scdn 保真 CDN 优先。
 * pathOr 消除 Array.isArray 样板;全部无副作用(无可变 push)。
 */
/**
 * probe 兜底解析:probe 无档位 / 逐档全失败时回退解析 probe 全量数据。
 * 仍无可播流 → 抛错(而非返回空数组,player 会误报「成功 0 条流」)。
 */
function resolveBiliLiveProbe(data: Record<string, any>, roomId: string): Stream[] {
  const probeStreams = parseBiliLiveStreams(data)
  if (!probeStreams.length) throw new Error(`bili:live 未找到可播流(房间 ${roomId} 可能未开播)`)
  return probeStreams
}

function parseBiliLiveStreams(data: Record<string, any>): Stream[] {
  const headers = { referer: "https://live.bilibili.com/", "user-agent": BILIBILI_UA }
  const urls: BiliLiveUrl[] = R.chain(
    (s) => R.chain((f) => R.chain(codecToUrls, pathArr(["codec"])(f)), pathArr(["format"])(s)),
    pathArr(["playurl_info", "playurl", "stream"])(data),
  )
  const sorted = R.sortWith(
    [
      R.ascend((u: BiliLiveUrl) => (u.format === "flv" ? 1 : 0)),
      R.ascend((u: BiliLiveUrl) => (u.host.includes("mcdn") || u.host.includes("scdn") ? 1 : 0)),
    ],
    urls,
  )
  return R.map((u: BiliLiveUrl) => ({ url: u.url, format: u.format, headers }), sorted)
}
