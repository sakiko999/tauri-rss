/**
 * huya 直播房间 channel —— 纯 HTTP,无签名。
 *
 * 复刻 producer 的 HuyaSite.getRoomDetail:爬 `m.huya.com/{roomId}` 取
 * `window.HNF_GLOBAL_INIT` JSON,产 Live Item(状态 + 元数据)。
 * resolveLivePlay 走 play.ts(HTTP-FLV,纯计算,实测可播)。
 */
import type { Item, Live } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { LivePlayable, RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch } from "../factory.ts"
import { httpText, now } from "../../host.ts"
import { parseHnfGlobalInit, resolveHuyaLivePlay } from "./play.ts"

const M_HUYA = "https://m.huya.com"
const UA_MOBILE =
  "Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36"

export class HuyaLiveChannel implements RssChannel {
  readonly key = "live:huya"
  readonly name = "虎牙直播房间"
  readonly kind = "live" as const
  readonly sourceInfoTpl = [{ key: "roomId", label: "直播间 ID", required: true }]
  // 直播源:implements LivePlayable。resolveLivePlay 走 play.ts(HTTP-FLV)。
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
