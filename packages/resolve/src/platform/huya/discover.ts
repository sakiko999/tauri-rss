/**
 * huya 发现层 —— 分区列表(供选分区) + 搜索(房间/主播)。
 *
 * 分区浏览分两级:顶层 4 个是**平台固定枚举**(参照 huya_site.dart:155 硬编码,
 * 无接口提供);二级分区走 `liveconfig/game/bussLive?bussType=`。
 * ⚠️ 二级接口的 UA 必须 Android Mobile(参照 kUserAgent;桌面 UA 可能被差异化)。
 *
 * 搜索走 `search.cdn.huya.com`(**零鉴权**)。⚠️ 响应里 `response["3"].docs` 是
 * 房间桶,但其中的 `room_id` 可能是错的——需拿 `uid+yyid` 去 `response["1"]`
 * (主播桶)匹配真实 `room_id`,失败才回退原值(参照 huya_site.dart:858 findRoomId)。
 */
import type { Item, Live } from "@tauri-playground/xml"
import { httpJson, now } from "../../host.ts"

/** 二级分区接口要求的 UA(Android Mobile,与主站桌面 UA 不同)。 */
const UA_ANDROID =
  "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36 Edg/117.0.0.0"
const UA_DESKTOP =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36"

/** 顶层分区(平台固定,无接口;id 直接作 bussType 与 gameId)。 */
export const HUYA_TOP_CATEGORIES = [
  { id: "1", name: "网游" },
  { id: "2", name: "单机" },
  { id: "8", name: "娱乐" },
  { id: "3", name: "手游" },
] as const

export interface HuyaSubCategory {
  /** = gid,作 gameId 列房间。 */
  id: string
  name: string
  parentId: string
  parentName: string
}

/** 列某顶层分区下的二级分区。 */
export async function fetchHuyaSubCategories(parentId: string): Promise<HuyaSubCategory[]> {
  const res = await httpJson<{ data?: Array<Record<string, any>> }>(
    `https://live.cdn.huya.com/liveconfig/game/bussLive?bussType=${encodeURIComponent(parentId)}`,
    { "user-agent": UA_ANDROID, referer: "https://www.huya.com/" },
  )
  const parentName = HUYA_TOP_CATEGORIES.find((c) => c.id === parentId)?.name ?? ""
  const list = Array.isArray(res?.data) ? res.data : []
  return list
    .map((item) => ({
      id: String(item.gid ?? ""),
      name: String(item.gameFullName ?? ""),
      parentId,
      parentName,
    }))
    .filter((c) => c.id !== "" && c.name !== "")
}

/** 封面补 OSS 压缩样式(dart:无 `?` 时追加)。 */
function ossCover(raw: unknown): string {
  const s = String(raw ?? "")
  return s && !s.includes("?") ? `${s}?x-oss-process=style/w338_h190` : s
}

/** 搜索房间。分页为 offset(start 从 0)。 */
export async function searchHuyaRooms(keyword: string, page = 1, pageSize = 20): Promise<Item[]> {
  const rows = Math.min(Math.max(pageSize, 1), 50)
  const url =
    `https://search.cdn.huya.com/?m=Search&do=getSearchContent&q=${encodeURIComponent(keyword)}` +
    `&uid=0&v=4&typ=-5&livestate=0&rows=${rows}&start=${(page - 1) * rows}`
  const res = await httpJson<{ response?: Record<string, { docs?: Array<Record<string, any>> }> }>(url, {
    "user-agent": UA_DESKTOP,
    referer: "https://www.huya.com/",
  })
  const rooms = res?.response?.["3"]?.docs ?? []
  // 主播桶(uid+yyid → 真实 room_id),修正房间桶里可能错的 room_id。
  const anchors = res?.response?.["1"]?.docs ?? []
  const findRoomId = (uid: unknown, yyid: unknown, fallback: string): string => {
    const hit = anchors.find((a) => String(a.uid) === String(uid) && String(a.yyid) === String(yyid))
    const id = String(hit?.room_id ?? "")
    return id || fallback
  }
  const t = now()
  return rooms
    .map((item): Live | null => {
      const fallback = String(item.room_id ?? "")
      const roomId = findRoomId(item.uid, item.yyid, fallback)
      if (!roomId) return null
      const title = String(item.game_introduction ?? "") || String(item.game_roomName ?? "")
      return {
        id: `huya:${roomId}`,
        sourceId: "live:huya:search",
        kind: "live",
        title,
        url: `https://www.huya.com/${roomId}`,
        thumbnail: ossCover(item.game_screenshot) || undefined,
        author: item.game_nick ? { name: String(item.game_nick) } : undefined,
        fetchedAt: t,
        platform: "huya",
        roomId,
        liveStatus: "live",
        online: Number(item.game_total_count ?? 0),
      }
    })
    .filter((x): x is Live => x !== null)
}
