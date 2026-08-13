/**
 * huya 直播房间 channel —— 纯 HTTP,无签名。
 *
 * 复刻 producer 的 HuyaSite.getRoomDetail:爬 `m.huya.com/{roomId}` 取
 * `window.HNF_GLOBAL_INIT` JSON,产 Live Item(状态 + 元数据)。
 * resolveLivePlay 走 play.ts(HTTP-FLV,纯计算,实测可播)。
 */
import type { Item, Live } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { DanmakuPlayable, LivePlayable, RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch } from "../factory.ts"
import { httpText, now } from "../../host.ts"
import { parseRoomIds } from "../../utils/room-ids.ts"
import { log } from "../../log.ts"
import { parseHnfGlobalInit, resolveHuyaLivePlay } from "./play.ts"
import { huyaDanmakuStream } from "./danmaku.ts"

const M_HUYA = "https://m.huya.com"
const UA_MOBILE =
  "Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36"

/** 单房间 → Live item(m.huya.com HNF_GLOBAL_INIT)。房间失败抛错,由调用方 catch 隔离。 */
async function fetchHuyaRoom(roomId: string): Promise<Live> {
  const html = await httpText(`${M_HUYA}/${roomId}`, { "user-agent": UA_MOBILE })
  const roomInfo = parseHnfGlobalInit(html)
  const ri = (roomInfo.roomInfo ?? {}) as Record<string, unknown>
  const tLiveInfo = (ri.tLiveInfo ?? {}) as Record<string, unknown>
  const tProfileInfo = (ri.tProfileInfo ?? {}) as Record<string, unknown>
  return {
    id: `huya:${String(tLiveInfo.lProfileRoom ?? roomId)}`,
    sourceId: "live:huya",
    kind: "live",
    title: String(tLiveInfo.sIntroduction ?? tLiveInfo.sRoomName ?? ""),
    url: `https://www.huya.com/${roomId}`,
    thumbnail: String(tLiveInfo.sScreenshot ?? ""),
    author: { name: String(tProfileInfo.sNick ?? "") },
    fetchedAt: now(),
    platform: "huya",
    roomId: String(tLiveInfo.lProfileRoom ?? roomId),
    liveStatus: ri.eLiveStatus === 2 ? "live" : "offline",
    online: Number(tLiveInfo.lTotalCount ?? 0),
    introduction: tLiveInfo.sIntroduction ? String(tLiveInfo.sIntroduction) : undefined,
  }
}

export class HuyaLiveChannel implements RssChannel {
  readonly key = "live:huya"
  readonly name = "虎牙直播房间"
  readonly kind = "live" as const
  readonly sourceInfoTpl = [{ key: "roomIds", label: "直播间 ID(逗号分隔,可多个)", required: true }]
  // 直播源:implements LivePlayable + DanmakuPlayable。resolveLivePlay 走 play.ts(HTTP-FLV)。
  // fetch 支持多房间(roomIds 逗号分隔);resolveLivePlay/getDanmaku 本就是按 roomId 工作,天然支持任一房间。
  getSource(info: SourceInfo): RssSource & LivePlayable & DanmakuPlayable {
    return {
      fetch: apiFetch(() => this.fetchItems(info), () => this.channelOptions(info)),
      resolveLivePlay: resolveHuyaLivePlay,
      getDanmaku: (roomId) => huyaDanmakuStream(roomId),
    }
  }

  private async fetchItems(info: SourceInfo): Promise<Item[]> {
    const roomIds = parseRoomIds(info)
    if (!roomIds.length) throw new Error("live:huya 需要 roomIds")
    const t = now()
    const rooms = await Promise.all(
      roomIds.map((roomId) =>
        fetchHuyaRoom(roomId).catch((e) => {
          log.huya.warn(`房间 ${roomId} 拉取失败,跳过:`, (e as Error)?.message)
          return null
        }),
      ),
    )
    return rooms.filter((r): r is Live => r !== null).map((live) => ({ ...live, fetchedAt: t }))
  }
  private channelOptions(info: SourceInfo): SerializeOptions {
    return { channelTitle: `虎牙直播 ${String(info.roomIds ?? info.roomId ?? "")}`, channelLink: `https://www.huya.com/${String(info.roomIds ?? info.roomId ?? "")}` }
  }
}
export { HuyaLiveHotChannel } from "./hot.ts"
