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
import type { Item, Live } from "@amoeba/xml"
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

/** 剥离搜索标题里的 `<em class="keyword">` 高亮标签。
 *  ⚠️ 曾用 `<.*?em.*?>`——`.*?` 会把**属性含 "em" 的任意标签**(如 `<img class="item">`)
 *  整段删掉。收紧到真正的 em 起止标签(属性可选)。 */
function stripEm(raw: unknown): string {
  return String(raw ?? "").replace(/<\/?em\b[^>]*>/g, "")
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

/** 搜索主播(`search_type=live_user`,匿名可用)。⚠️ 该接口无 `page_size`。 */
export async function searchBiliAnchors(keyword: string, page = 1): Promise<Item[]> {
  const params = new URLSearchParams({ search_type: "live_user", keyword, page: String(page) })
  const res = await biliClient.getJson<{
    data?: { result?: Array<Record<string, any>> }
  }>(`${API_MAIN}/x/web-interface/search/type?${params.toString()}`, {
    referer: "https://search.bilibili.com/",
    buvid: true,
  })
  const list = res?.data?.result ?? []
  const t = now()
  return list
    .map((item): Live | null => {
      const roomId = String(item.roomid ?? "")
      if (!roomId) return null
      return {
        id: `bilibili:${roomId}`,
        sourceId: "bili:anchor",
        kind: "live",
        title: stripEm(item.uname),
        url: `${LIVE}/${roomId}`,
        thumbnail: coverUrl(item.uface),
        author: item.uname ? { name: stripEm(item.uname) } : undefined,
        fetchedAt: t,
        platform: "bilibili",
        roomId,
        liveStatus: Number(item.is_live ?? 0) === 1 ? "live" : "offline",
      }
    })
    .filter((x): x is Live => x !== null)
}

/** 搜视频 UP主的命中(medium 号 = bili:user_video 的 uid 参数)。 */
export interface BiliUserHit {
  mid: string
  uname: string
  fans?: number
  videos?: number
  /** 头像(已补 https: 前缀;不加 @400w 后缀 —— 空间头像非封面,尺寸后缀不保证可用)。 */
  upic?: string
}

/**
 * 搜索视频 UP主(`search_type=bili_user`,匿名 + buvid)。
 * 与 live_user(搜主播)同端点不同 type;result[] 每项是一个「人」而非直播间,
 * 无 roomid,产出 BiliUserHit 供「搜索添加 → 订阅其投稿」用(落地 bili:user_video)。
 */
export async function searchBiliUsers(keyword: string, page = 1): Promise<BiliUserHit[]> {
  const params = new URLSearchParams({ search_type: "bili_user", keyword, page: String(page) })
  const res = await biliClient.getJson<{
    data?: { result?: Array<Record<string, any>> }
  }>(`${API_MAIN}/x/web-interface/search/type?${params.toString()}`, {
    referer: "https://search.bilibili.com/",
    buvid: true,
  })
  const list = res?.data?.result ?? []
  return list
    .map((item): BiliUserHit | null => {
      const mid = String(item.mid ?? "")
      if (!mid) return null
      return {
        mid,
        uname: stripEm(item.uname),
        fans: Number(item.fans ?? 0) || undefined,
        videos: Number(item.videos ?? 0) || undefined,
        upic: httpsPrefix(String(item.upic ?? "")),
      }
    })
    .filter((x): x is BiliUserHit => x !== null)
}

/** `//i0.hdslb.com/...` → `https://...`(其余原样;空串返回 undefined)。 */
function httpsPrefix(raw: string): string | undefined {
  if (!raw) return undefined
  return raw.startsWith("//") ? `https:${raw}` : raw
}
