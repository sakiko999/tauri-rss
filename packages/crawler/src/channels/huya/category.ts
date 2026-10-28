import { httpJson, now } from "@amoeba/resolve"
/**
 * huya 分区房间 —— 按二级分区列直播间(`gameId` = bussLive 的 gid)。
 *
 * 顶层分区是平台固定枚举(4 个),二级分区见 `resolve/platform/huya/discover.ts`
 * 的 `fetchHuyaSubCategories`。本 channel 参数 = 二级分区 id。
 *
 * 分页:页码制(page 递增),服务端每页固定 ~120 条(不接受 pageSize)。
 */
import type { Live } from "@amoeba/xml"

import { makeApiChannel } from "../factory.ts"

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36"

export const HuyaCategoryChannel = makeApiChannel({
  key: "live:huya:category",
  name: "虎牙分区直播",
  kind: "live",
  sourceInfoTpl: [{ key: "gameId", label: "分区 ID(如 1=英雄联盟、862=CS2)", required: true }],
  channelTitle: (info) => `虎牙分区直播 ${info.gameId ?? ""}`,
  channelLink: "https://www.huya.com/",
  pageable: { first: 2, step: 1 },
  fetchPage: async (info, page) => {
    const gameId = String(info.gameId ?? "").trim()
    if (!gameId) throw new Error("huya:category 需要 gameId 参数")
    const res = await httpJson<{ data?: { datas?: Array<Record<string, any>> } }>(
      `https://www.huya.com/cache.php?m=LiveList&do=getLiveListByPage&tagAll=0&gameId=${encodeURIComponent(gameId)}&page=${page}`,
      { "user-agent": UA, referer: "https://www.huya.com/" },
    )
    const t = now()
    const datas = Array.isArray(res?.data?.datas) ? res.data.datas : []
    return datas.map((item): Live => {
      const profileRoom = String(item.profileRoom ?? "")
      const title = String(item.introduction ?? "") || String(item.roomName ?? "")
      let cover = item.screenshot ? String(item.screenshot) : ""
      if (cover && !cover.includes("?")) cover += "?x-oss-process=style/w338_h190"
      return {
        id: `huya:${profileRoom}`,
        sourceId: "live:huya:category",
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
  },
})
