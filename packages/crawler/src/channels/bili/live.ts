/**
 * bili:live —— bilibili 直播房间 channel。
 *
 * 复刻 producer 的 BilibiliSite.getRoomDetail(wbi 签名 + buvid cookie),
 * 产单个 Live Item(状态 + 元数据,不含 playUrls——懒解析)。
 * 零登录:wbi 签名 + buvid finger cookie。
 */
import type { Item, Live } from "@tauri-playground/xml"
import { BaseChannel } from "../base.ts"
import type { SourceInfo } from "../../index.ts"
import { now } from "../../host.ts"
import { createBilibiliClient } from "./client.ts"

const API_LIVE = "https://api.live.bilibili.com"

export class BiliLiveChannel extends BaseChannel {
  readonly key = "bili:live"
  readonly name = "bilibili 直播房间"
  readonly kind = "live" as const
  readonly sourceInfoTpl = [{ key: "roomId", label: "直播间 ID", required: true }]
  protected async fetchItems(info: SourceInfo): Promise<Item[]> {
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
  protected channelOptions(info: SourceInfo) {
    return { channelTitle: `bilibili 直播 ${info.roomId ?? ""}`, channelLink: `https://live.bilibili.com/${info.roomId ?? ""}` }
  }
}
