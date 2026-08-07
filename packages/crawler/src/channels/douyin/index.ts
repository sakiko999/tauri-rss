/**
 * douyin 直播房间 channel —— HTTP + ABogus 签名(host.js)。
 *
 * 复刻 producer 的 DouyinSite:对 `live.douyin.com/webcast/...` 请求用 host.js
 * 执行 ABOGUS_JS 里的 `getABogus(query, UA)` 生成 a_bogus 参数;ttwid cookie 由
 * 首页 warmup 抓取(memoized)。
 *
 * 产 Live Item(状态 + 元数据),playUrls 藏在上游 stream_url(live_core_sdk_data),
 * 由下游 resolveLivePlay 懒解析(本地,无额外请求)。
 */
import type { Item, Live, Stream } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { LivePlayable, RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch } from "../factory.ts"
import { now } from "../../host.ts"
import { ABOGUS_JS } from "./abogus.ts"

const LIVE = "https://live.douyin.com"
const UA =
  "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.5845.97 Safari/537.36 Core/1.116.567.400 QQBrowser/19.7.6764.400"

/**
 * 默认 ttwid cookie(复刻 dart douyin_site.dart)。enter/play 接口没有合法 ttwid
 * 会返回空 body(200, len 0);warmup 失败时兜底用它。
 */
const DEFAULT_TTWID_COOKIE =
  "ttwid=1%7CB1qls3GdnZhUov9o2NxOMxxYS2ff6OSvEWbv0ytbES4%7C1680522049%7C280d802d6d478e3e78d0c807f7c487e7ffec0ae4e5fdd6a0fe74c3c6af149511"

export class DouyinLiveChannel implements RssChannel {
  readonly key = "live:douyin"
  readonly name = "抖音直播房间"
  readonly kind = "live" as const
  readonly sourceInfoTpl = [{ key: "roomId", label: "直播间 ID", required: true }]
  // 直播源:implements LivePlayable,resolveLivePlay 闭包捕获 this 实例状态(ABogus 签名 + cookie jar)。
  getSource(info: SourceInfo): RssSource & LivePlayable {
    return {
      fetch: apiFetch(() => this.fetchItems(info), () => this.channelOptions(info)),
      resolveLivePlay: (roomId) => this.resolveLivePlayImpl(roomId),
    }
  }

  /** 懒初始化的 cookie jar(warmup GET 抓到的新鲜 ttwid 等)。 */
  private cookieJar = ""
  private cookiePromise: Promise<void> | null = null

  /** 懒解析直播流:重拉 enter 拿 stream_url,本地提取 flv/hls(无额外请求)。 */
  private async resolveLivePlayImpl(roomId: string): Promise<Stream[]> {
    const res = await this.fetchRoomDetail(roomId)
    const room = (res?.data?.data?.[0] ?? res?.data?.room ?? {}) as Record<string, any>
    return parseDouyinStreams((room.stream_url ?? {}) as Record<string, any>)
  }

  private async fetchItems(info: SourceInfo): Promise<Item[]> {
    const roomId = info.roomId ?? ""
    if (!roomId) throw new Error("live:douyin 需要 roomId")

    const res = await this.fetchRoomDetail(roomId)
    const room = (res?.data?.data?.[0] ?? res?.data?.room ?? {}) as Record<string, any>
    const user = (res?.data?.data?.[0]?.user ?? res?.data?.user ?? {}) as Record<string, any>
    const streamUrl = (room.stream_url ?? {}) as Record<string, any>
    const isLive = toInt(room.status) === 2

    const live: Live = {
      id: `douyin:${String(room.id_str ?? roomId)}`,
      sourceId: "live:douyin",
      kind: "live",
      title: String(room.title ?? ""),
      url: `${LIVE}/${roomId}`,
      thumbnail: String(streamUrl?.default?.push_hd?.main?.[0]?.flv ?? room?.cover?.url_list?.[0] ?? ""),
      author: { name: String(user.nickname ?? ""), avatar: String(user?.avatar_thumb?.url_list?.[0] ?? "") || undefined },
      fetchedAt: now(),
      platform: "douyin",
      roomId: String(room.id_str ?? roomId),
      liveStatus: isLive ? "live" : "offline",
      online: toInt(room?.room_view_stats?.display_value),
      introduction: strOr(room.intro),
      // stream_url 藏 play 数据,供下游 getPlayQualities/Urls(本地解析)。
      raw: streamUrl,
    }
    return [live]
  }

  private channelOptions(info: SourceInfo): SerializeOptions {
    return { channelTitle: `抖音直播 ${info.roomId ?? ""}`, channelLink: `${LIVE}/${info.roomId ?? ""}` }
  }

  // ── internals ───────────────────────────────────────────────────────────

  /** 拉 enter 接口完整响应(room/user/stream_url 同源)。ABogus 签名 + ttwid cookie。 */
  private async fetchRoomDetail(roomId: string): Promise<Record<string, any>> {
    const base = `${LIVE}/webcast/room/web/enter/`
    const params = new URLSearchParams({
      aid: "6383",
      app_name: "douyin_web",
      live_id: "1",
      device_platform: "web",
      language: "zh-CN",
      browser_language: "zh-CN",
      browser_platform: "Win32",
      browser_name: "Chrome",
      browser_version: "125.0.0.0",
      web_rid: roomId,
    })
    const url = await this.abogusUrl(`${base}?${params.toString()}`)
    return this.getJson(url)
  }

  /** ABogus 签名:url + msToken → getABogus(query, UA) → 追加 a_bogus。 */
  private async abogusUrl(url: string): Promise<string> {
    const msToken = generateMsToken(107)
    const withMs = `${url}&msToken=${msToken}`
    const query = withMs.split("?")[1] ?? ""
    const aBogus = String(globalThis.appHost.js.call(ABOGUS_JS, "getABogus", [query, UA]) ?? "")
    return `${withMs}&a_bogus=${encodeURIComponent(aBogus)}`
  }

  private async getJson(url: string): Promise<Record<string, any>> {
    await this.ensureCookie()
    const res = await globalThis.appHost.http.request({
      url,
      method: "GET",
      responseType: "json",
      headers: {
        "user-agent": UA,
        referer: LIVE,
        authority: "live.douyin.com",
        cookie: this.cookieJar || DEFAULT_TTWID_COOKIE,
      },
    })
    if (res.status < 200 || res.status >= 300) throw new Error(`douyin HTTP ${res.status}: ${url.slice(0, 120)}`)
    // backend 已按 responseType:"json" 解析;空 body 时抛错(抖音常无合法 ttwid 返回空)。
    const body = res.body
    if (body === undefined || body === null || body === "") throw new Error(`douyin empty body for ${url.slice(0, 80)}`)
    return typeof body === "string" ? (JSON.parse(body) as Record<string, any>) : (body as Record<string, any>)
  }

  /**
   * 首页 warmup 抓新鲜 ttwid(Set-Cookie);失败兜底默认值。memoized。
   * 注意:依赖 HttpBackend 回传 `set-cookie` header(example 的 nodeBackend 返回空
   * headers,此时会兜底 DEFAULT_TTWID_COOKIE)。真实后端应回传 set-cookie。
   */
  private ensureCookie(): Promise<void> {
    if (this.cookieJar) return Promise.resolve()
    if (!this.cookiePromise) {
      this.cookiePromise = (async () => {
        try {
          const res = await globalThis.appHost.http.request({
            url: `${LIVE}/`,
            method: "GET",
            headers: { "user-agent": UA },
          })
          const sc = String(res.headers["set-cookie"] ?? "").split("\n")
          const jar = sc
            .map((c) => c.split(";")[0]!.trim())
            .filter((c) => c.includes("="))
            .join("; ")
          if (jar) this.cookieJar = jar
        } catch {
          this.cookieJar = DEFAULT_TTWID_COOKIE
        }
      })()
    }
    return this.cookiePromise
  }
}

function toInt(v: unknown): number | undefined {
  const n = Number(v)
  return Number.isFinite(n) && v !== null && v !== undefined && v !== "" ? n : undefined
}

function strOr(v: unknown): string | undefined {
  return v === undefined || v === null || v === "" ? undefined : String(v)
}

/** 随机 msToken(dart: generateMsToken)。非加密 RNG 可接受。 */
function generateMsToken(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  let out = ""
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

/**
 * 从抖音 enter 响应的 stream_url 提取各清晰度可播流。
 * 结构:stream_url.live_core_sdk_data.pull_data.options.qualities[] → sdk_key;
 * stream_data(JSON 字符串)按 sdk_key 展开 data[key].main.{flv,hls}。
 * 按清晰度从高到低返回;每档 flv 优先(flv 体积小加载快),hls 兜底。
 */
function parseDouyinStreams(streamUrl: Record<string, any>): Stream[] {
  const liveCore = (streamUrl?.live_core_sdk_data ?? {}) as Record<string, any>
  const pullData = (liveCore?.pull_data ?? {}) as Record<string, any>
  const qualities: Array<Record<string, any>> = Array.isArray(pullData?.options?.qualities)
    ? pullData.options.qualities
    : []
  const streamDataRaw = String(pullData?.stream_data ?? "")
  if (!streamDataRaw.trimStart().startsWith("{")) return []
  let streamData: Record<string, any>
  try {
    streamData = JSON.parse(streamDataRaw) as Record<string, any>
  } catch {
    return []
  }

  const headers = { referer: LIVE, "user-agent": UA }
  const sorted = [...qualities].sort((a, b) => (toInt(b.level) ?? 0) - (toInt(a.level) ?? 0))
  const streams: Stream[] = []
  for (const q of sorted) {
    const sdkKey = String(q?.sdk_key ?? "")
    const main = (streamData?.data?.[sdkKey]?.main ?? {}) as Record<string, any>
    const flv = String(main?.flv ?? "")
    const hls = String(main?.hls ?? "")
    if (flv) streams.push({ url: flv, format: "flv", headers: { ...headers, authority: LIVE } })
    else if (hls) streams.push({ url: hls, format: "hls", headers })
  }
  return streams
}
