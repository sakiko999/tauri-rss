/**
 * huya 直播房间 channel —— 纯 HTTP,无签名。
 *
 * 复刻 producer 的 HuyaSite.getRoomDetail:爬 `m.huya.com/{roomId}` 取
 * `window.HNF_GLOBAL_INIT` JSON,产 Live Item(状态 + 元数据)。
 * playUrls 需 Tars 二进制 codec,暂不实现(同 producer)。
 */
import type { Item, Live, Stream } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { LivePlayable, RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch } from "../factory.ts"
import { httpText, now } from "../../host.ts"

const M_HUYA = "https://m.huya.com"
const UA_MOBILE =
  "Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36"

/** 虎牙可播流需 Tars 二进制 codec,暂未实现——抛清晰错误(同 producer)。 */
function resolveHuyaLivePlay(_roomId: string): Promise<Stream[]> {
  return Promise.reject(new Error("live:huya 直播流解析暂未实现(需 Tars 二进制 codec)"))
}

export class HuyaLiveChannel implements RssChannel {
  readonly key = "live:huya"
  readonly name = "虎牙直播房间"
  readonly kind = "live" as const
  readonly sourceInfoTpl = [{ key: "roomId", label: "直播间 ID", required: true }]
  // 直播源:implements LivePlayable。resolveLivePlay 暂为占位(Tars codec 未实现)——
  // 声明了能力契约但方法体抛未实现,语义上仍是直播源(区别于「根本不是直播源」)。
  getSource(info: SourceInfo): RssSource & LivePlayable {
    return {
      fetch: apiFetch(() => this.fetchItems(info), () => this.channelOptions(info)),
      resolveLivePlay: resolveHuyaLivePlay,
    }
  }

  private async fetchItems(info: SourceInfo): Promise<Item[]> {
    const roomId = info.roomId ?? ""
    if (!roomId) throw new Error("live:huya 需要 roomId")
    const html = await httpText(`${M_HUYA}/${roomId}`, { "user-agent": UA_MOBILE })
    const roomInfo = parseHnfGlobalInit(html)
    const ri = (roomInfo.roomInfo ?? {}) as Record<string, unknown>
    const tLiveInfo = (ri.tLiveInfo ?? {}) as Record<string, unknown>
    const tProfileInfo = (ri.tProfileInfo ?? {}) as Record<string, unknown>
    const t = now()
    const live: Live = {
      id: `huya:${String(tLiveInfo.lProfileRoom ?? roomId)}`,
      sourceId: "live:huya",
      kind: "live",
      title: String(tLiveInfo.sIntroduction ?? tLiveInfo.sRoomName ?? ""),
      url: `https://www.huya.com/${roomId}`,
      thumbnail: String(tLiveInfo.sScreenshot ?? ""),
      author: { name: String(tProfileInfo.sNick ?? "") },
      fetchedAt: t,
      platform: "huya",
      roomId: String(tLiveInfo.lProfileRoom ?? roomId),
      liveStatus: ri.eLiveStatus === 2 ? "live" : "offline",
      online: Number(tLiveInfo.lTotalCount ?? 0),
      introduction: tLiveInfo.sIntroduction ? String(tLiveInfo.sIntroduction) : undefined,
    }
    return [live]
  }
  private channelOptions(info: SourceInfo): SerializeOptions {
    return { channelTitle: `虎牙直播 ${info.roomId ?? ""}`, channelLink: `https://www.huya.com/${info.roomId ?? ""}` }
  }
}

/** 从页面 HTML 抠 `window.HNF_GLOBAL_INIT = {...}` 并解析(替换内联 function 让 JSON.parse 通过)。 */
function parseHnfGlobalInit(html: string): Record<string, any> {
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
