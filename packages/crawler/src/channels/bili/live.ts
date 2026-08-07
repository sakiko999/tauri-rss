/**
 * bili:live —— bilibili 直播房间 channel。
 *
 * 复刻 producer 的 BilibiliSite.getRoomDetail(wbi 签名 + buvid cookie),
 * 产单个 Live Item(状态 + 元数据,不含 playUrls——懒解析)。
 * 零登录:wbi 签名 + buvid finger cookie。
 */
import type { Item, Live, Stream } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { RssChannel, SourceInfo } from "../../index.ts"
import { createApiSource } from "../factory.ts"
import { now } from "../../host.ts"
import { BILIBILI_UA, createBilibiliClient } from "./client.ts"

const API_LIVE = "https://api.live.bilibili.com"

export class BiliLiveChannel implements RssChannel {
  readonly key = "bili:live"
  readonly name = "bilibili 直播房间"
  readonly kind = "live" as const
  readonly sourceInfoTpl = [{ key: "roomId", label: "直播间 ID", required: true }]
  // 懒解析能力作为 factory capabilities 装配进 source:resolveLivePlay(roomId)。
  getSource = createApiSource((info) => this.fetchItems(info), (info) => this.channelOptions(info), { resolveLivePlay: resolveBiliLivePlay })

  private async fetchItems(info: SourceInfo): Promise<Item[]> {
    const roomId = info.roomId ?? ""
    if (!roomId) throw new Error("bili:live 需要 roomId")
    const client = createBilibiliClient({ referer: "https://live.bilibili.com/", buvid: true, live: true })
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
 * 懒解析 bilibili 直播流:getRoomPlayInfo(带 buvid cookie + live 签名)→ hls/flv 直链。
 * 独立纯函数(不依赖 channel 实例),由 factory 装配进 source。
 */
async function resolveBiliLivePlay(roomId: string): Promise<Stream[]> {
  const client = createBilibiliClient({ referer: "https://live.bilibili.com/", buvid: true, live: true })
  const params = await client.signLiveParams({
    room_id: roomId,
    protocol: "0,1",
    format: "0,2",
    codec: "0,1",
    platform: "web",
    qn: "10000",
  })
  const res = await client.getJson<{ data?: Record<string, any> }>(
    `${API_LIVE}/xlive/web-room/v2/index/getRoomPlayInfo?${params}`,
  )
  return parseBiliLiveStreams(res?.data ?? {})
}

/**
 * 从 getRoomPlayInfo 响应提取可播流。
 * 结构:data.playurl_info.playurl.stream[] → format[] → codec[],每个 codec 有
 * base_url + url_info[](host + extra),完整 url = host + base_url + extra。
 * 按 host 排序(scdn/mcdn 排后,保真 CDN 优先),format 由 base_url 后缀推断。
 */
function parseBiliLiveStreams(data: Record<string, any>): Stream[] {
  const playUrl = (data?.playurl_info?.playurl ?? {}) as Record<string, any>
  const streams: Array<Record<string, any>> = Array.isArray(playUrl?.stream) ? playUrl.stream : []
  const urls: Array<{ url: string; format: string; host: string }> = []
  const headers = { referer: "https://live.bilibili.com/", "user-agent": BILIBILI_UA }

  for (const s of streams) {
    const formats: Array<Record<string, any>> = Array.isArray(s?.format) ? s.format : []
    for (const f of formats) {
      const codecs: Array<Record<string, any>> = Array.isArray(f?.codec) ? f.codec : []
      for (const c of codecs) {
        const baseUrl = String(c?.base_url ?? "")
        const urlInfos: Array<Record<string, any>> = Array.isArray(c?.url_info) ? c.url_info : []
        const format = baseUrl.includes(".m3u8") ? "hls" : baseUrl.includes(".flv") ? "flv" : "live"
        for (const ui of urlInfos) {
          const host = String(ui?.host ?? "")
          const extra = String(ui?.extra ?? "")
          if (host && baseUrl) urls.push({ url: `${host}${baseUrl}${extra}`, format, host })
        }
      }
    }
  }

  urls.sort((a, b) => Number(a.host.includes("mcdn") || a.host.includes("scdn")) - Number(b.host.includes("mcdn") || b.host.includes("scdn")))
  return urls.map((u) => ({ url: u.url, format: u.format, headers }))
}
