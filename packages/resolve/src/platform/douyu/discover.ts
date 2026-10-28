/**
 * douyu 发现层 —— 分区列表 + 搜索(房间/主播)。
 *
 * 分区:`m.douyu.com/api/cate/list` 一次返回全部一二级(`cate1Info`/`cate2Info`,
 * 内存按 `cate1Id` 关联)。**零鉴权**。
 *
 * 按分区列房:`gapi/rkc/directory/mixList/2_{areaId}/{page}`,page 在 **path** 里
 * (从 1 起)。⚠️ 须过滤 `type != 1`(广告/推荐位混在 `data.rl` 里)。**零鉴权**。
 *
 * 搜索:`japi/search/api/searchShow`(房间)。参照侧带设备 DID cookie,但
 * **2026-09 实测匿名同样返回全部结果**(带/不带 cookie 响应一致),故不注入。
 * 是否在播 = `isLive==1 && roomType==0`(roomType 非 0 是录播/轮播)。
 */

import type { Item, Live } from "@amoeba/xml"

import { httpJson, now } from "../../host.ts"
import { parseCount } from "../../utils/count.ts"

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"

export interface DouyuCategory {
  id: string
  name: string
  children: Array<{ id: string; name: string }>
}

/** 列全部一级分区(含二级)。 */
export async function fetchDouyuCategories(): Promise<DouyuCategory[]> {
  const res = await httpJson<{
    data?: { cate1Info?: Array<Record<string, any>>; cate2Info?: Array<Record<string, any>> }
  }>("https://m.douyu.com/api/cate/list", { "user-agent": UA, referer: "https://www.douyu.com/" })
  const cate1 = Array.isArray(res?.data?.cate1Info) ? res.data.cate1Info : []
  const cate2 = Array.isArray(res?.data?.cate2Info) ? res.data.cate2Info : []
  return cate1
    .map((c1) => {
      const id = String(c1.cate1Id ?? "")
      return {
        id,
        name: String(c1.cate1Name ?? ""),
        children: cate2
          .filter((c2) => String(c2.cate1Id ?? "") === id)
          .map((c2) => ({ id: String(c2.cate2Id ?? ""), name: String(c2.cate2Name ?? "") })),
      }
    })
    .filter((c) => c.id !== "")
}

/**
 * 按分区列房间(page 从 1 起;服务端每页固定条数)。
 * 返回 `{ items, hasMore }`:可 pageable 的渠道过滤条目(type!=1 广告位)必须显式
 * 回 hasMore,否则整页被滤空会被 core 判成到底(工厂契约)。`data.pgcnt` 是总页数
 * (实测 area=1 → 4),用它精确判;缺失回退「原始行非空」。
 */
export async function fetchDouyuCategoryRooms(areaId: string, page = 1): Promise<{ items: Item[]; hasMore: boolean }> {
  const res = await httpJson<{ data?: { rl?: Array<Record<string, any>>; pgcnt?: number } }>(
    `https://www.douyu.com/gapi/rkc/directory/mixList/2_${encodeURIComponent(areaId)}/${page}`,
    { "user-agent": UA, referer: "https://www.douyu.com/" },
  )
  const t = now()
  const list = Array.isArray(res?.data?.rl) ? res.data.rl : []
  const pgcnt = Number(res?.data?.pgcnt ?? 0)
  const items = list
    // type != 1 是广告/推荐位,不是真实房间。缺失按 1 保留(宁多勿误删)。
    .filter((item) => Number(item.type ?? 1) === 1)
    .map((item): Live => {
      const rid = String(item.rid ?? "")
      return {
        id: `douyu:${rid}`,
        sourceId: "live:douyu:category",
        kind: "live",
        title: String(item.rn ?? ""),
        url: `https://www.douyu.com/${rid}`,
        thumbnail: item.rs16 ? String(item.rs16) : undefined,
        author: item.nn ? { name: String(item.nn) } : undefined,
        fetchedAt: t,
        platform: "douyu",
        roomId: rid,
        liveStatus: "live",
        online: Number(item.ol ?? 0),
      }
    })
  return { items, hasMore: pgcnt > 0 ? page < pgcnt : list.length > 0 }
}

/** 搜索房间(匿名可用)。分页 page 从 1 起。 */
export async function searchDouyuRooms(keyword: string, page = 1, pageSize = 20): Promise<Item[]> {
  const size = Math.min(Math.max(pageSize, 1), 50)
  const res = await httpJson<{ data?: { relateShow?: Array<Record<string, any>> } }>(
    `https://www.douyu.com/japi/search/api/searchShow?kw=${encodeURIComponent(keyword)}&page=${page}&pageSize=${size}`,
    {
      "user-agent": UA,
      origin: "https://www.douyu.com",
      referer: "https://www.douyu.com/search/",
    },
  )
  const t = now()
  const list = Array.isArray(res?.data?.relateShow) ? res.data.relateShow : []
  return list
    .map((item): Live | null => {
      const rid = String(item.rid ?? "")
      if (!rid) return null
      // roomType 非 0 是录播/轮播,非在播房间。
      const live = Number(item.isLive ?? 0) === 1 && Number(item.roomType ?? 0) === 0
      return {
        id: `douyu:${rid}`,
        sourceId: "live:douyu:search",
        kind: "live",
        title: String(item.roomName ?? ""),
        url: `https://www.douyu.com/${rid}`,
        thumbnail: item.roomSrc ? String(item.roomSrc) : undefined,
        author: item.nickName ? { name: String(item.nickName) } : undefined,
        fetchedAt: t,
        platform: "douyu",
        roomId: rid,
        liveStatus: live ? "live" : "offline",
        // ⚠️ hot 是带单位的展示串("133.1万"),必须按单位换算 —— 裸剥非数字得到 133,
        // 丢 3 个数量级(133.1万=1331000)。
        online: parseCount(item.hot),
      }
    })
    .filter((x): x is Live => x !== null)
}

/** 搜索主播(匿名可用)。分页 page 从 1 起。 */
export async function searchDouyuAnchors(keyword: string, page = 1, pageSize = 20): Promise<Item[]> {
  const size = Math.min(Math.max(pageSize, 1), 50)
  const res = await httpJson<{ data?: { relateUser?: Array<Record<string, any>> } }>(
    `https://www.douyu.com/japi/search/api/searchUser?kw=${encodeURIComponent(keyword)}&page=${page}&pageSize=${size}&filterType=1`,
    {
      "user-agent": UA,
      origin: "https://www.douyu.com",
      referer: "https://www.douyu.com/search/",
    },
  )
  const t = now()
  const list = Array.isArray(res?.data?.relateUser) ? res.data.relateUser : []
  return list
    .map((item): Live | null => {
      const a = (item.anchorInfo ?? {}) as Record<string, any>
      const rid = String(a.rid ?? "")
      if (!rid) return null
      const live = Number(a.isLive ?? 0) === 1 && Number(a.roomType ?? 0) === 0
      return {
        id: `douyu:${rid}`,
        sourceId: "live:douyu:anchor",
        kind: "live",
        title: String(a.nickName ?? ""),
        url: `https://www.douyu.com/${rid}`,
        thumbnail: a.avatar ? String(a.avatar) : undefined,
        author: a.nickName ? { name: String(a.nickName) } : undefined,
        fetchedAt: t,
        platform: "douyu",
        roomId: rid,
        liveStatus: live ? "live" : "offline",
        // ⚠️ searchUser 的 anchorInfo **没有** hot/人气字段(实测字段集:
        // nickName/rid/isLive/roomType/fansNum/followerCount… 无观众/人气值)。
        // 原先读 a.hot 恒得 0 → 主播搜索卡片「0 人在看」是假数据。宁可不报:
        // 返回 undefined,UI 显示「—」而非妄称 0 人。
      }
    })
    .filter((x): x is Live => x !== null)
}
