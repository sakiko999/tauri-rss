/**
 * twitch 直播解析 —— PlaybackAccessToken → usher master → 档位排序 → Stream[]。
 *
 * 链路(匿名,2026-10-20 实测):
 *   1. GraphQL **persisted query** `PlaybackAccessToken`(手写查询已不可用:
 *      新版 schema 报 `argument: channelName is required`)→ `signature` + `value`
 *      (value 是 JSON,约 20 分钟有效);
 *   2. 拼 `usher.ttvnw.net/api/v2/channel/hls/<login>.m3u8`(sig/token 作 query);
 *   3. **master 没有 `Access-Control-Allow-Origin`** → hls.js 加载不了,必须经
 *      `appHost.http` 服务端拉取并解析,把 **variant URL** 作为 Stream.url 交给播放器
 *      (variant playlist 与分片是 `ACAO: *`)。⚠️ 不要把 master URL 直接给播放器。
 *
 * ⚠️ token/signature **不进日志、不进错误文案**;master URL 含 token,报错只给状态码。
 * ⚠️ persisted query hash 会轮换(2025-11 曾整体替换一次)——只改 `TWITCH_PLAYBACK_TOKEN_HASH`。
 */
import type { Stream } from "@amoeba/xml"
import { twitchGql } from "./client.ts"
import { normalizeTwitchLogin } from "../../utils/twitch.ts"

/** PlaybackAccessToken 的 persisted query hash(Twitch 改版时只改这里)。 */
export const TWITCH_PLAYBACK_TOKEN_HASH = "ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9"

const USHER_BASE = "https://usher.ttvnw.net/api/v2/channel/hls"

/** master 里的一档变体(已按高度降序,audio_only 最后)。 */
export interface TwitchVariant {
  url: string
  bandwidth: number
  height?: number
  frameRate?: number
  quality: string
}

interface PlaybackToken {
  signature: string
  value: string
}

/**
 * 取直播播放 token。频道的 `value` 是 JSON(含 geoblock_reason / blackout_enabled /
 * maximum_resolution 等诊断字段);地区/版权受限时抛错(不重试,重试也无用)。
 */
async function fetchPlaybackToken(login: string): Promise<PlaybackToken> {
  const data = await twitchGql<{ streamPlaybackAccessToken?: PlaybackToken | null }>({
    operationName: "PlaybackAccessToken",
    variables: {
      isLive: true,
      login,
      isVod: false,
      vodID: "",
      platform: "web",
      playerType: "site",
    },
    extensions: {
      persistedQuery: { version: 1, sha256Hash: TWITCH_PLAYBACK_TOKEN_HASH },
    },
  })
  const token = data.streamPlaybackAccessToken
  if (!token?.signature || !token.value) {
    // 离线/不存在/无权限都落在这里(不把 token 拼进文案)。
    throw new Error(`twitch: 无法获取播放 token（频道 ${login} 可能离线）`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(token.value)
  } catch {
    throw new Error("twitch: 播放 token 格式异常")
  }
  if (!parsed || typeof parsed !== "object") throw new Error("twitch: 播放 token 格式异常")
  const value = parsed as Record<string, unknown>
  const geoblock = typeof value.geoblock_reason === "string" ? value.geoblock_reason.trim() : ""
  const blackout = value.blackout_enabled === true || value.blackout_enabled === "true"
  if (geoblock || blackout) {
    const why = geoblock ? `地区/版权受限(${geoblock})` : "版权限制(blackout)"
    throw new Error(`twitch: ${login} 无法播放 —— ${why}`)
  }
  return token
}

/** 拼 usher master URL(随机 `p` = 播放会话标识)。⚠️ 含 sig/token,不得外泄到日志。 */
function buildMasterUrl(login: string, token: PlaybackToken): string {
  const params = new URLSearchParams({
    platform: "web",
    p: String(Math.floor(Math.random() * 1_000_000_000)),
    allow_source: "true",
    allow_audio_only: "true",
    playlist_include_framerate: "true",
    // 固定 h264:避开 AV1/HEVC source 的兼容性问题。
    supported_codecs: "h264",
    sig: token.signature,
    token: token.value,
  })
  return `${USHER_BASE}/${login}.m3u8?${params.toString()}`
}

/** 拉 master(HLS 播放入口,**媒体流量**:不计 RPM,但仍占全局并发)。 */
async function fetchMaster(masterUrl: string, login: string): Promise<string> {
  let res: Awaited<ReturnType<typeof globalThis.appHost.http.request>>
  try {
    res = await globalThis.appHost.http.request({
      url: masterUrl,
      method: "GET",
      responseType: "text",
      policy: { platform: "twitch", metered: false },
    })
  } catch (e) {
    // ⚠️ 宿主错误串可能原样带出请求 URL(reqwest: "error sending request for url (...)"),
    // 而 master URL 含 sig/token —— 不透传原文,只保留错误类型名。
    const kind = e instanceof Error && e.name ? e.name : "网络错误"
    throw new Error(`twitch: 频道 ${login} 播放列表请求失败(${kind})`)
  }
  if (res.status < 200 || res.status >= 300) {
    // ⚠️ 错误文案不带 URL —— master URL 含 sig/token。404 = 频道未开播(实测离线即 404)。
    throw new Error(`twitch: 频道 ${login} 未开播或播放列表不可用(HTTP ${res.status})`)
  }
  return typeof res.body === "string" ? res.body : String(res.body ?? "")
}

/** 解析 `RESOLUTION=1920x1080` → 1080。 */
function resolutionHeight(raw: string | undefined): number | undefined {
  const m = /^\d{2,5}x(\d{2,5})$/.exec(raw ?? "")
  const h = m ? Number(m[1]) : NaN
  return Number.isFinite(h) && h > 0 ? h : undefined
}

/** 解析一行属性表(`KEY=value,KEY2="quoted,value"`),引号内的逗号不切分。 */
function parseAttrList(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /([A-Za-z0-9-]+)=("[^"]*"|[^,]*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) {
    const key = m[1]!
    let value = m[2] ?? ""
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
    out[key] = value
  }
  return out
}

/**
 * 档位名:优先 `NAME`(实测 usher v2 用的是 `IVS-NAME`,由调用方合成),
 * 其次 URL 里的 `<height>p<fps>` / `audio_only`,再按 RESOLUTION 的 `<height>p`;
 * 都没有 RESOLUTION 的档位 = audio_only(实测其 `IVS-NAME` 也确实是 audio_only)。
 */
function variantQuality(
  name: string | undefined,
  url: string,
  height: number | undefined,
  frameRate: number | undefined,
): string {
  const trimmed = name?.trim()
  if (trimmed) return trimmed
  const path = url.split("?")[0] ?? url
  if (/audio_only/i.test(path)) return "audio_only"
  const byUrl = /(?:^|\/)(\d{3,4})p(\d{1,3})?(?:\/|$)/i.exec(path)
  if (byUrl) return byUrl[2] ? `${byUrl[1]}p${byUrl[2]}` : `${byUrl[1]}p`
  if (height !== undefined) return frameRate ? `${height}p${Math.round(frameRate)}` : `${height}p`
  return "audio_only"
}

/**
 * 解析 usher master:**纯函数**(自检用)。只认 `#EXT-X-STREAM-INF` + 下一行绝对 URL;
 * 一档 = `{ url, bandwidth, height?, frameRate?, quality }`。
 *
 * master 的原始顺序**不是**高→低(实测 audio_only 夹在中间、1080p 反而靠后),
 * 故显式排序:高度降序、同高度按带宽降序,无 RESOLUTION 的 audio_only 排最后。
 */
export function parseTwitchMaster(master: string): TwitchVariant[] {
  const lines = master.split(/\r?\n/).map((l) => l.trim())
  const out: TwitchVariant[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (!line.startsWith("#EXT-X-STREAM-INF:")) continue
    const attrs = parseAttrList(line.slice("#EXT-X-STREAM-INF:".length))
    // 下一行非空、非注释即 variant URL。
    let url = ""
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j]!
      if (!next || next.startsWith("#")) continue
      url = next
      break
    }
    if (!url) continue
    const height = resolutionHeight(attrs.RESOLUTION)
    const bandwidth = Number(attrs.BANDWIDTH ?? 0)
    const fps = Number(attrs["FRAME-RATE"])
    const frameRate = attrs["FRAME-RATE"] && Number.isFinite(fps) ? fps : undefined
    out.push({
      url,
      bandwidth: Number.isFinite(bandwidth) ? bandwidth : 0,
      ...(height !== undefined ? { height } : {}),
      ...(frameRate !== undefined ? { frameRate } : {}),
      // usher v2 实测给 `IVS-NAME`("audio_only" 等),老格式给 `NAME`。
      quality: variantQuality(attrs.NAME || attrs["IVS-NAME"], url, height, frameRate),
    })
  }
  out.sort((a, b) => {
    const ha = a.height ?? -1
    const hb = b.height ?? -1
    if (hb !== ha) return hb - ha
    return b.bandwidth - a.bandwidth
  })
  return out
}

/**
 * master → `Stream[]`:最高档在前,audio_only 最后(选流契约 = player 取 `streams[0]`)。
 * 无可用档位抛错(不能静默返回空数组——上层会误判「无流可播」)。
 */
export function twitchStreamsFromMaster(master: string): Stream[] {
  const variants = parseTwitchMaster(master)
  if (!variants.length) throw new Error("twitch: master 播放列表无可用档位")
  return variants.map((v) => {
    const stream: Stream = { url: v.url, format: "hls", quality: v.quality }
    if (v.height !== undefined) stream.rate = v.height
    return stream
  })
}

/**
 * 懒解析 Twitch 直播可播流(login = 频道名)。
 * 返回的 url 是 **variant playlist**(不是 master —— master 无 ACAO)。
 */
export async function resolveTwitchLivePlay(login: string): Promise<Stream[]> {
  const normalized = normalizeTwitchLogin(login)
  if (!normalized) throw new Error(`twitch: 无效频道名 ${login}`)
  const token = await fetchPlaybackToken(normalized)
  const master = await fetchMaster(buildMasterUrl(normalized, token), normalized)
  return twitchStreamsFromMaster(master)
}
