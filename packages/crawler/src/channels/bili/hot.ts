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

import { biliClient, now } from "@amoeba/resolve"
import type { Live } from "@amoeba/xml"

import { makeApiChannel } from "../factory.ts"

const API_LIVE = "https://api.live.bilibili.com"
const PAGE_SIZE = 30

export const BiliLiveHotChannel = makeApiChannel({
  key: "bili:live:hot",
  name: "B站直播热门",
  kind: "live",
  channelTitle: () => "B站直播热门",
  channelLink: "https://live.bilibili.com/",
  // 页码游标(首页 fetch 用 page=1,翻页从 2 起步 +1;本页为空即止)。
  pageable: { first: 2, step: 1 },
  fetchPage: async (info, page) => {
    const base = `${API_LIVE}/xlive/web-interface/v1/second/getListByArea`
    const signed = await biliClient.signWeb(`platform=web&sort=online&page_size=${PAGE_SIZE}&page=${page}`, info.cookie)
    const res = await biliClient.getJson<{ data?: { list?: Array<Record<string, any>> } }>(`${base}?${signed}`, {
      referer: "https://live.bilibili.com/",
      // ⚠️ 必须带 buvid3(匿名也可):getListByArea 对**无 buvid 的请求**直接返回
      // -352。实测 wbi 签名齐全但仍 -352,加 buvid 后 code 0(与 bili:live 同)。
      buvid: true,
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
  },
})
