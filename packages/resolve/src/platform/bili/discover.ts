/**
 * bili 发现层 —— 分区列表 + 搜索(直播房间/主播)。
 *
 * 分区列表:`room/v1/Area/getList?parent_id=0&need_entrance=1` — **匿名可用**
 * (只需 buvid;一次返回全部一二级:一级 `id/name`,`list[]` 为二级)。
 * ⚠️ **按分区列房(`second/getList`)不在本文件**——它需 **wbi 签名 + access_id +
 * cookie**,且匿名实测仍 `-352` 风控(2026-09:带 buvid3/access_id/wbi 均无效),
 * 须登录态。见 `docs/capability-gaps.md`。
 *
 * 搜索:`api.bilibili.com/x/web-interface/search/type?search_type=live`(**匿名可用**,
 * 实测 40 条)。⚠️ 标题带 `<em class="keyword">` 高亮标签,须剥离。
 */
import type { Item, Live } from "@tauri-playground/xml"
import { now } from "../../host.ts"
import { biliClient } from "./client.ts"

const API_MAIN = "https://api.bilibili.com"
const LIVE = "https://live.bilibili.com"

export interface BiliCategory {
  id: string
  name: string
  children: Array<{ id: string; name: string }>
}

/** 列全部直播分区(一级含二级)。匿名 + buvid。 */
export async function fetchBiliCategories(): Promise<BiliCategory[]> {
  const res = await biliClient.getJson<{
    data?: Array<Record<string, any>>
  }>(`https://api.live.bilibili.com/room/v1/Area/getList?need_entrance=1&parent_id=0`, {
    referer: `${LIVE}/`,
    buvid: true,
  })
  const list = Array.isArray(res?.data) ? res.data : []
  return list
    .map((parent) => {
      const id = String(parent.id ?? "")
      const subsRaw = Array.isArray(parent.list) ? parent.list : []
      return {
        id,
        name: String(parent.name ?? ""),
        children: subsRaw.map((s) => ({ id: String(s.id ?? ""), name: String(s.name ?? "") })),
      }
    })
    .filter((c) => c.id !== "")
}

/** 剥离搜索标题里的 `<em class="keyword">` 高亮标签。 */
function stripEm(raw: unknown): string {
  return String(raw ?? "").replace(/<.*?em.*?>/g, "")
}

/** 封面补尺寸后缀(搜索接口返回的 cover 无需 `https:` 前缀处理时会带 `//`)。 */
function coverUrl(raw: unknown): string | undefined {
  const s = String(raw ?? "")
  if (!s) return undefined
  const full = s.startsWith("//") ? `https:${s}` : s
  return full.includes("@") ? full : `${full}@400w.jpg`
}

/** 搜索直播房间(匿名可用)。分页 page 从 1 起。 */
export async function searchBiliRooms(keyword: string, page = 1, pageSize = 20): Promise<Item[]> {
  const size = Math.min(Math.max(pageSize, 1), 50)
  const params = new URLSearchParams({
    search_type: "live",
    keyword,
    page: String(page),
    page_size: String(size),
  })
  const res = await biliClient.getJson<{
    data?: { result?: { live_room?: Array<Record<string, any>> } }
  }>(`${API_MAIN}/x/web-interface/search/type?${params.toString()}`, {
    referer: "https://search.bilibili.com/",
    buvid: true,
  })
  const rooms = res?.data?.result?.live_room ?? []
  const t = now()
  return rooms
    .map((item): Live | null => {
      const roomId = String(item.roomid ?? "")
      if (!roomId) return null
      return {
        id: `bilibili:${roomId}`,
        sourceId: "bili:search",
        kind: "live",
        title: stripEm(item.title),
        url: `${LIVE}/${roomId}`,
        thumbnail: coverUrl(item.cover) ?? coverUrl(item.user_cover),
        author: item.uname ? { name: stripEm(item.uname) } : undefined,
        fetchedAt: t,
        platform: "bilibili",
        roomId,
        liveStatus: Number(item.live_status ?? 0) === 1 ? "live" : "offline",
        online: Number(item.online ?? 0),
      }
    })
    .filter((x): x is Live => x !== null)
}
