/**
 * douyu 直播房间 channel —— HTTP + CryptoJS 签名(host.js)。
 *
 * 复刻 producer 的 DouyuSite.getRoomDetail:爬 `betard/{roomId}` 取房间信息,
 * `swf_api/homeH5Enc` 取签名 JS blob(crptext),用 host.js 执行
 * `CRYPTO_JS + crptext` 里的 `ub98484234(roomId, did, time)` 得到签名 body。
 *
 * 签名只用于 getH5Play(拉 RTMP 直链)。本 channel 产出 Live Item(状态+元数据),
 * playUrls 需额外 H5Play 请求,交由下游 resolveLivePlay 懒解析(同 huya)。
 */
import type { Item, Live, Stream } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { DanmakuPlayable, LivePlayable, RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch } from "../factory.ts"
import { now } from "../../host.ts"
import { log } from "../../log.ts"
import { toInt } from "../../utils/number.ts"
import { parseRoomIds } from "../../utils/room-ids.ts"
import { strOr } from "../../utils/str.ts"
import { douyuClient, douyuResolveStreams, douyuRoomInfo } from "../../platform/douyu"


const BASE = "https://www.douyu.com"

export class DouyuLiveChannel implements RssChannel {
  readonly key = "live:douyu"
  readonly name = "斗鱼直播房间"
  readonly kind = "live" as const
  readonly sourceInfoTpl = [{ key: "roomIds", label: "直播间 ID(逗号分隔,可多个)", required: true }]
  // 直播源:implements LivePlayable + DanmakuPlayable。resolveLivePlay 闭包捕获 this 实例状态(签名重取)。
  // fetch 支持多房间(roomIds 逗号分隔);resolveLivePlay/getDanmaku 本就是按 roomId 工作,天然支持任一房间。
  getSource(info: SourceInfo): RssSource & LivePlayable & DanmakuPlayable {
    return {
      fetch: apiFetch(() => this.fetchItems(info), () => this.channelOptions(info)),
      resolveLivePlay: (roomId) => this.resolveLivePlayImpl(roomId),
      getDanmaku: (roomId) => douyuClient.getDanmaku(roomId),
    }
  }

  /**
   * 懒解析直播流:签名 + 列档 + 逐档拉(全流程在 douyuResolveStreams)。
   * 返回**全档位**(每档一个 Stream,quality=档位名,rate=档位值)。
   */
  private async resolveLivePlayImpl(roomId: string): Promise<Stream[]> {
    return douyuResolveStreams(roomId)
  }

  private async fetchItems(info: SourceInfo): Promise<Item[]> {
    const roomIds = parseRoomIds(info)
    if (!roomIds.length) throw new Error("live:douyu 需要 roomIds")
    const t = now()
    const rooms = await Promise.all(
      roomIds.map((roomId) =>
        this.fetchOne(roomId).catch((e) => {
          log.douyu.warn(`房间 ${roomId} 拉取失败,跳过:`, (e as Error)?.message)
          return null
        }),
      ),
    )
    return rooms.filter((r): r is Live => r !== null).map((live) => ({ ...live, fetchedAt: t }))
  }

  /** 单房间 → Live item(房间失败抛错,由调用方 catch 隔离)。签名留待 resolveLivePlay 懒解析。 */
  private async fetchOne(roomId: string): Promise<Live> {
    const roomInfo = await douyuRoomInfo(roomId)
    return {
      id: `douyu:${roomId}`,
      sourceId: "live:douyu",
      kind: "live",
      title: String(roomInfo.room_name ?? ""),
      url: `${BASE}/${roomId}`,
      thumbnail: String(roomInfo.room_pic ?? ""),
      author: { name: String(roomInfo.owner_name ?? ""), avatar: String(roomInfo.owner_avatar ?? "") || undefined },
      fetchedAt: now(),
      platform: "douyu",
      roomId: String(roomInfo.room_id ?? roomId),
      liveStatus: toInt(roomInfo.show_status) === 1 && toInt(roomInfo.videoLoop) !== 1 ? "live" : "offline",
      online: toInt(roomInfo.room_biz_all?.hot),
      isRecord: toInt(roomInfo.videoLoop) === 1,
      introduction: strOr(roomInfo.show_details),
    }
  }

  private channelOptions(info: SourceInfo): SerializeOptions {
    return { channelTitle: `斗鱼直播 ${String(info.roomIds ?? info.roomId ?? "")}`, channelLink: `${BASE}/${String(info.roomIds ?? info.roomId ?? "")}` }
  }
}
