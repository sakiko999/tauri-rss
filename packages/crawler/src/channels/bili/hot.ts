/**
 * bili 直播热门 —— getListByArea(wbi 签名),支持分页加载更多。
 *
 * 复刻 dart getRecommendRooms(bilibili_site.dart):`sort=online` 按人气排序,
 * 产多条 Live item(roomId/title/uname/online)——订阅后列表即开播房间,点开可播/弹幕。
 * 分页:**页码制**(page 递增,page_size 固定 30),`isPageable` 探测 → fetchMore 翻页
 * (本页为空 = 没有更多)。
 *
 * ⚠️ 能力抽离:只输出 Live item 基础信息(与 rsshub 一致)。流/弹幕解析统一走
 * crawler/resolver(按 item.url→live.bilibili.com/{roomId} 路由)。翻页(Pageable)保留。
 */
import type { Item, Live } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { Pageable, RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch, apiFetchMore } from "../factory.ts"
import { now } from "../../host.ts"
import { biliClient } from "../../platform/bili"

const API_LIVE = "https://api.live.bilibili.com"
const PAGE_SIZE = 30

export class BiliLiveHotChannel implements RssChannel {
  readonly key = "bili:live:hot"
  readonly name = "bilibili 直播热门"
  readonly kind = "live" as const
  readonly defaultInfo = {}
  /** 纯输出 + 翻页;流/弹幕走 crawler/resolver。 */
  getSource(info: SourceInfo): RssSource & Pageable {
    return {
      fetch: apiFetch(() => this.fetchItems(info, 1), () => this.channelOptions(info)),
      // 页码游标(首页 fetch 用 page=1,翻页从 2 起步 +1;本页为空即止)。
      fetchMore: apiFetchMore((page) => this.fetchItems(info, page), () => this.channelOptions(info), { first: 2, step: 1 }),
    }
  }

  private async fetchItems(info: SourceInfo, page: number): Promise<Item[]> {
    const base = `${API_LIVE}/xlive/web-interface/v1/second/getListByArea`
    const signed = await biliClient.signWeb(`platform=web&sort=online&page_size=${PAGE_SIZE}&page=${page}`, info.cookie)
    const res = await biliClient.getJson<{ data?: { list?: Array<Record<string, any>> } }>(`${base}?${signed}`, {
      referer: "https://live.bilibili.com/",
      cookie: info.cookie,
    })
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
