/**
 * douyin 发现层 —— 分区树 + 按分区列房 + 搜索。
 *
 * **分区树**:首页 SSR 的 `categoryData`(复刻 pure_live `douyin_site.dart:111`
 * 的平衡大括号截取 + `\"`/`\\` 反转义)。实测 2026-09:8 顶层 + 7 子分区。
 *
 * **列分区房间**:`webcast/web/partition/detail/room/v2/`(与 hot.ts 同接口,
 * 差别只在参数化的 partition/partition_type)。
 * ⚠️ **partition_type 不是常量**:顶层分区 type=4、子分区 type=1,必须与 id 配套。
 *
 * **搜索**:⚠️ 实测 2026-09 三路中**只有第三路匿名可用**——
 *   1. `aweme/v1/web/live/search`(www.douyin.com)→ `2483 请先登录`,**需登录**
 *   2. `aweme/v1/web/general/search/stream` → 同样 `2483`,**需登录**
 *   3. `webcast/web/partition/search`(**匿名可用**)→ 关键词命中分区 → 再列各分区房间
 * 故本实现只走第三路。路 1/2 待有登录态时再补(可显著提升相关性)。
 *
 * ⚠️ **第三路的固有局限(实测)**:`partition/search` 只按**分区名**匹配,且只认
 * **游戏名级**分区——`原神` 命中,而 `舞蹈`/`美食`/`聊天`(仅顶层大类/非游戏词)
 * 一律**命中 0 个分区 → 搜索返空**。故本 channel 对非游戏类关键词基本不可用;
 * 这是匿名方案的硬边界,补路 1/2(需登录)才能解。
 */
import type { Item, Live } from "@tauri-playground/xml"
import { httpJson, httpText, now } from "../../host.ts"
import { UA_ENTER } from "./abogus.ts"
import { douyinClient } from "./client.ts"

const LIVE = "https://live.douyin.com"

// ── 分区树(SSR categoryData)────────────────────────────────────────────────

/** 单个分区(顶层或子)。 */
export interface DouyinPartition {
  id: string
  /** 列房间时必须一并带上(顶层 4 / 子 1)。 */
  type: number
  title: string
}

/** 顶层分区 + 其子分区。 */
export interface DouyinCategory {
  partition: DouyinPartition
  subs: DouyinPartition[]
}

/** SSR 里 categoryData 的起始 marker(转义形态)。 */
const MARKER = '{\\"pathname\\":\\"/\\",\\"categoryData\\":'

/** 从 HTML 抽出 categoryData 的 JSON 原文(平衡大括号 + 反转义)。失败返回 null。 */
function extractCategoryJson(html: string): string | null {
  const start = html.indexOf(MARKER)
  if (start < 0) return null
  let depth = 0
  let end = start
  let found = false
  for (; end < html.length; end++) {
    const ch = html[end]
    if (ch === "{") {
      depth++
      found = true
    } else if (ch === "}") {
      depth--
      if (found && depth === 0) break
    }
  }
  if (depth !== 0) return null
  // 反转义:先 `\"`→`"`,再 `\\`→`\`(顺序不可颠倒)。
  return html.slice(start, end + 1).replace(/\\"/g, '"').replace(/\\\\/g, "\\")
}

function toPartition(raw: unknown): DouyinPartition | null {
  const p = (raw ?? {}) as Record<string, unknown>
  const id = String(p.id_str ?? "").trim()
  const type = Number(p.type ?? NaN)
  if (!id || Number.isNaN(type)) return null
  return { id, type, title: String(p.title ?? "").trim() }
}

/** 抓抖音首页 → 解析 categoryData。返回顶层分区(含子分区);失败抛错。 */
export async function fetchDouyinCategories(): Promise<DouyinCategory[]> {
  // UA 必须 QQBrowser(与 enter 同约束;Chrome 可能返空 body)。
  const html = await httpText(LIVE, { referer: LIVE, "user-agent": UA_ENTER })
  const json = extractCategoryJson(html)
  if (!json) throw new Error("douyin: 首页 SSR 未找到 categoryData")
  const parsed = JSON.parse(json) as { categoryData?: unknown[] }
  const list = Array.isArray(parsed.categoryData) ? parsed.categoryData : []
  const out: DouyinCategory[] = []
  for (const raw of list) {
    const item = (raw ?? {}) as Record<string, unknown>
    const partition = toPartition(item.partition)
    if (!partition) continue
    const subsRaw = Array.isArray(item.sub_partition) ? item.sub_partition : []
    const subs = subsRaw
      .map((s) => toPartition((s as Record<string, unknown>)?.partition))
      .filter((p): p is DouyinPartition => p !== null)
    out.push({ partition, subs })
  }
  return out
}

// ── 列分区房间 ──────────────────────────────────────────────────────────────

/** 分区房间响应的 `data.data[]` → Live 列表(与 hot.ts 同款字段映射)。 */
function mapPartitionRooms(list: Array<Record<string, any>>, sourceId: string): Item[] {
  const t = now()
  return list.map((item): Live => {
    const room = (item.room ?? {}) as Record<string, any>
    const webRid = String(item.web_rid ?? "")
    const owner = (room.owner ?? {}) as Record<string, any>
    const viewStats = (room.room_view_stats ?? {}) as Record<string, any>
    const coverList = Array.isArray(room.cover?.url_list) ? (room.cover.url_list as unknown[]) : []
    return {
      id: `douyin:${webRid}`,
      sourceId,
      kind: "live",
      title: String(room.title ?? ""),
      url: `${LIVE}/${webRid}`,
      thumbnail: coverList[0] ? String(coverList[0]) : undefined,
      author: owner.nickname ? { name: String(owner.nickname) } : undefined,
      fetchedAt: t,
      platform: "douyin",
      roomId: webRid,
      liveStatus: "live",
      online: Number(viewStats.display_value ?? 0),
    }
  })
}

/** 按分区列房间(offset 游标;partition_type 必须与 id 配套)。 */
export async function fetchDouyinPartitionRooms(
  partition: string,
  partitionType: string,
  offset = 0,
  count = 15,
  sourceId = "live:douyin:category",
): Promise<Item[]> {
  const params = new URLSearchParams({
    aid: "6383",
    app_name: "douyin_web",
    live_id: "1",
    device_platform: "web",
    language: "zh-CN",
    cookie_enabled: "true",
    screen_width: "1980",
    screen_height: "1080",
    browser_language: "zh-CN",
    browser_platform: "Win32",
    browser_name: "Edge",
    browser_version: "125.0.0.0",
    browser_online: "true",
    count: String(count),
    offset: String(offset),
    partition,
    partition_type: partitionType,
    req_from: "2",
  })
  const res = await douyinClient.getJson<{ data?: { data?: Array<Record<string, any>> } }>(
    `${LIVE}/webcast/web/partition/detail/room/v2/?${params.toString()}`,
    { referer: LIVE },
  )
  return mapPartitionRooms(Array.isArray(res?.data?.data) ? res.data.data : [], sourceId)
}

// ── 搜索(第三路:关键词 → 分区 → 列房)─────────────────────────────────────

/** 关键词命中分区(仅在 #3 路径用)。 */
async function searchDouyinPartitions(keyword: string): Promise<DouyinPartition[]> {
  const res = await httpJson<{ data?: { SearchResult?: Array<Record<string, any>> } }>(
    `${LIVE}/webcast/web/partition/search/?keyword=${encodeURIComponent(keyword)}&aid=6383`,
    { "user-agent": UA_ENTER, referer: `${LIVE}/` },
  )
  const list = res?.data?.SearchResult ?? []
  return list.map((x) => toPartition(x?.partition)).filter((p): p is DouyinPartition => p !== null)
}

/**
 * 搜索直播间。⚠️ 只走匿名的第三路(前两路 `2483 需登录`,见文件头)。
 * 取命中分区的前 3 个,各列一批房间后合并去重、截到 pageSize。
 */
export async function searchDouyinRooms(keyword: string, _page = 1, pageSize = 20): Promise<Item[]> {
  const kw = keyword.trim()
  if (!kw) return []
  const parts = await searchDouyinPartitions(kw)
  if (parts.length === 0) return []
  const seen = new Set<string>()
  const out: Item[] = []
  for (const p of parts.slice(0, 3)) {
    try {
      const rooms = await fetchDouyinPartitionRooms(p.id, String(p.type), 0, pageSize, "live:douyin:search")
      for (const r of rooms as Live[]) {
        if (seen.has(r.roomId)) continue
        seen.add(r.roomId)
        out.push(r)
        if (out.length >= pageSize) return out
      }
    } catch {
      // 单个分区失败不影响其余(参照侧同款容错)。
    }
  }
  return out
}
