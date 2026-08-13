/**
 * bili 直播热门 —— getListByArea(wbi 签名)一次返回 30 个开播房间。
 *
 * 复刻 dart getRecommendRooms(bilibili_site.dart):`sort=online` 按人气排序,
 * 产多条 Live item(roomId/title/uname/online)——订阅后列表即开播房间,点开可播/弹幕。
 *
 * 能力:对外是独立 channel(无参,热门发现);内部**委托同平台 BiliLiveChannel**
 * 的 resolveLivePlay/getDanmaku(hot 是「特殊的 live channel」——外部区分开,机制复用)。
 */
import type { Item, Live } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { DanmakuPlayable, LivePlayable, RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch } from "../factory.ts"
import { now } from "../../host.ts"
import { createBilibiliClient } from "./client.ts"
import { BiliLiveChannel } from "./live.ts"

const API_LIVE = "https://api.live.bilibili.com"

export class BiliLiveHotChannel implements RssChannel {
  readonly key = "bili:live:hot"
  readonly name = "bilibili 直播热门"
  readonly kind = "live" as const
  readonly defaultInfo = {}
  /** 内部持同平台 live channel,委托其懒解析/弹幕能力(对外 channel 身份仍是 hot)。 */
  getSource(info: SourceInfo): RssSource & LivePlayable & DanmakuPlayable {
    const room = new BiliLiveChannel().getSource(info)
    return {
      fetch: apiFetch(() => this.fetchItems(info), () => this.channelOptions(info)),
      resolveLivePlay: (roomId) => room.resolveLivePlay(roomId),
      getDanmaku: (roomId) => room.getDanmaku(roomId),
    }
  }

  private async fetchItems(info: SourceInfo): Promise<Item[]> {
    const client = createBilibiliClient({ referer: "https://live.bilibili.com/", cookie: info.cookie })
    const base = `${API_LIVE}/xlive/web-interface/v1/second/getListByArea`
    const signed = await client.signWeb("platform=web&sort=online&page_size=30&page=1")
    const res = await client.getJson<{ data?: { list?: Array<Record<string, any>> } }>(`${base}?${signed}`)
    const t = now()
    const list = Array.isArray(res?.data?.list) ? res.data.list : []
    return list.map((item): Live => {
      const roomid = String(item.roomid ?? "")
      const cover = item.cover ? String(item.cover) : ""
      return {
        id: `bilibili:${roomid}`,
        sourceId: "bili:live:hot",
        kind: "live",
        title: String(item.title ?? ""),
        url: `https://live.bilibili.com/${roomid}`,
        thumbnail: cover || undefined,
        author: item.uname ? { name: String(item.uname) } : undefined,
        fetchedAt: t,
        platform: "bilibili",
        roomId: roomid,
        liveStatus: "live",
        online: Number(item.online ?? 0),
      }
    })
  }

  private channelOptions(_info: SourceInfo): SerializeOptions {
    return { channelTitle: "bilibili 直播热门", channelLink: "https://live.bilibili.com/" }
  }
}
