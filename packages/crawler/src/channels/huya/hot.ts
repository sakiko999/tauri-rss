/**
 * huya 直播热门 —— cache.php LiveList(无鉴权)一次返回一页开播房间。
 *
 * 复刻 dart getRecommendRooms(huya_site.dart):`m=LiveList&do=getLiveListByPage&tagAll=0`,
 * `data.datas[]` → {profileRoom, introduction/roomName, nick, screenshot, totalCount}。
 *
 * 能力:对外是独立 channel(无参,热门发现);内部**委托同平台 HuyaLiveChannel**
 * 的 resolveLivePlay/getDanmaku(hot 是「特殊的 live channel」——外部区分开,机制复用)。
 */
import type { Item, Live } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { DanmakuPlayable, LivePlayable, RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch, liveHotSource } from "../factory.ts"
import { httpJson, now } from "../../host.ts"
import { HuyaLiveChannel } from "./index.ts"

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36"

export class HuyaLiveHotChannel implements RssChannel {
  readonly key = "live:huya:hot"
  readonly name = "虎牙直播热门"
  readonly kind = "live" as const
  readonly defaultInfo = {}
  /** 内部持同平台 live channel,委托其懒解析/弹幕能力(对外 channel 身份仍是 hot)。 */
  getSource(info: SourceInfo): RssSource & LivePlayable & DanmakuPlayable {
    return liveHotSource(new HuyaLiveChannel().getSource(info), {
      fetch: apiFetch(() => this.fetchItems(info), () => this.channelOptions(info)),
    })
  }

  private async fetchItems(_info: SourceInfo): Promise<Item[]> {
    const res = await httpJson<{ data?: { datas?: Array<Record<string, any>> } }>(
      "https://www.huya.com/cache.php?m=LiveList&do=getLiveListByPage&tagAll=0&page=1",
      { "user-agent": UA },
    )
    const t = now()
    const datas = Array.isArray(res?.data?.datas) ? res.data.datas : []
    return datas.map((item): Live => {
      const profileRoom = String(item.profileRoom ?? "")
      const title = String(item.introduction ?? "") || String(item.roomName ?? "")
      let cover = item.screenshot ? String(item.screenshot) : ""
      // dart:无水印后缀则补 oss 压缩样式(省带宽)。
      if (cover && !cover.includes("?")) cover += "?x-oss-process=style/w338_h190"
      return {
        id: `huya:${profileRoom}`,
        sourceId: "live:huya:hot",
        kind: "live",
        title,
        url: `https://www.huya.com/${profileRoom}`,
        thumbnail: cover || undefined,
        author: item.nick ? { name: String(item.nick) } : undefined,
        fetchedAt: t,
        platform: "huya",
        roomId: profileRoom,
        liveStatus: "live",
        online: Number(item.totalCount ?? 0),
      }
    })
  }

  private channelOptions(_info: SourceInfo): SerializeOptions {
    return { channelTitle: "虎牙直播热门", channelLink: "https://www.huya.com/" }
  }
}
