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
 * ⚠️ **匿名搜索无解,已用真实 Edge 验证(2026-10)**:在干净 Edge 里直接跑路 1/2
 * 仍是 `2483`;`www.douyin.com/search?type=live` 页面自身也被 **verify-center 挑战**
 * (`4031 已阻止此次访问`),DOM 只渲染「登录后即可搜索更多精彩视频」+ 扫码框。
 * 即**登录硬门槛**,与浏览器指纹无关——browser 模拟对此无能为力(与小红书不同:
 * xhs 是 TLS 指纹差异,browser 能解;抖音是账号门槛,browser 不能解)。
 *
 * ⚠️ **第三路的固有局限(实测)**:`partition/search` 只按**分区名**匹配,且只认
 * **游戏名级**分区——`原神` 命中,而 `舞蹈`/`音乐`/`聊天`(顶层大类)一律
 * **命中 0 个分区 → 搜索返空**。
 *
 * ✅ **破法(2026-10)**:顶层分区名**恰恰就是这些词**——首页 `categoryData` 的 8 个顶层
 * 分区 = 聊天/音乐/游戏/二次元/舞蹈/文化/生活/运动(实测 15 个分区列房全部匿名可用,
 * 含 7 个游戏子分区)。故**本地匹配分区树**即可覆盖上游不认的大类:上游命中(精确,
 * 如 `原神`)+ 本地 title 匹配(`舞蹈` → 105/type4)合并去重。**无需登录、无需浏览器**。
 * 残留缺口:分区树只到「大类」粒度,`美食`(属「生活」)这类三级词仍无直接命中。
 */
import type { Item, Live } from "@amoeba/xml"
import { httpJson, httpText, now } from "../../host.ts"
import { UA_ENTER } from "./abogus.ts"
import { douyinClient } from "./client.ts"
import { douyinOnline } from "./audience.ts"

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
      online: douyinOnline(room),
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

/** 按 title 本地匹配分区树(顶层 + 子分区),双向包含即可——覆盖上游 `partition/search` 不认的大类词。 */
function matchLocalPartitions(tree: DouyinCategory[], kw: string): DouyinPartition[] {
  const out: DouyinPartition[] = []
  for (const c of tree) {
    for (const p of [c.partition, ...c.subs]) {
      if (p.title && (p.title.includes(kw) || kw.includes(p.title))) out.push(p)
    }
  }
  return out
}

/**
 * 搜索直播间。⚠️ 只走匿名的第三路(前两路 `2483 需登录`,见文件头)。
 *
 * 命中源 = 上游 `partition/search`(精确,如 `原神`)**∪** 本地分区树 title 匹配
 * (覆盖上游不认的大类,如 `舞蹈`/`音乐`/`聊天`)。合并去重后取前 3 个分区各列一批房间,
 * 合并去重、截到 pageSize。
 *
 * ⚠️ 本地树匹配失败(首页 SSR 变脸)时静默回落纯上游路径——退化为旧行为,不抛错。
 */
export async function searchDouyinRooms(keyword: string, _page = 1, pageSize = 20): Promise<Item[]> {
  const kw = keyword.trim()
  if (!kw) return []

  const parts = await searchDouyinPartitions(kw)
  try {
    const tree = await fetchDouyinCategories()
    for (const p of matchLocalPartitions(tree, kw)) {
      if (!parts.some((q) => q.id === p.id)) parts.push(p)
    }
  } catch {
    // 分区树不可用:退化为纯上游结果。
  }
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

// ── 热点榜 + 搜索联想(匿名可用;填补「抖音搜索增强」缺口)─────────────────────

/** 抖音热点榜词条。 */
export interface DouyinTrend {
  word: string
  /** 热度值(原始整数)。 */
  hotValue?: number
  /** 榜位(1 起)。 */
  position?: number
  /** 词封面图(可选)。 */
  cover?: string
}

/**
 * 抖音热点榜 —— `www.douyin.com/aweme/v1/web/hot/search/list`(**匿名 200**,实测
 * 2026-10)。50 条热词带 hot_value/position/封面。⚠️ 与 `live:douyin:hot`(直播热门
 * **房间**)不同:这是全站**热点词**。
 */
export async function fetchDouyinTrends(): Promise<DouyinTrend[]> {
  const res = await httpJson<{ data?: { word_list?: Array<Record<string, any>> } }>(
    "https://www.douyin.com/aweme/v1/web/hot/search/list/?device_platform=webapp&aid=6383&channel=channel_pc_web",
    { "user-agent": UA_ENTER, referer: "https://www.douyin.com/" },
  )
  const list = res?.data?.word_list ?? []
  return list
    .map((w): DouyinTrend | null => {
      const word = String(w.word ?? "").trim()
      if (!word) return null
      const coverList = Array.isArray(w.word_cover?.url_list) ? (w.word_cover.url_list as unknown[]) : []
      return {
        word,
        hotValue: Number(w.hot_value ?? 0) || undefined,
        position: Number(w.position ?? 0) || undefined,
        cover: coverList[0] ? String(coverList[0]) : undefined,
      }
    })
    .filter((v): v is DouyinTrend => v !== null)
}

/**
 * 搜索联想词 —— `www.douyin.com/aweme/v1/web/search/sug`(**匿名 200**,实测 2026-10)。
 * 输入前缀 → 补全候选(帮用户找到准确关键词)。
 * ⚠️ 关联的**搜索本身**(`live/search` / `general/search/stream`)仍 2483 需登录 ——
 * 但联想词匿名可用,可独立作为「输入补全」能力。
 */
export async function fetchDouyinSuggestions(keyword: string): Promise<string[]> {
  const kw = keyword.trim()
  if (!kw) return []
  const res = await httpJson<{ sug_list?: Array<Record<string, any>> }>(
    `https://www.douyin.com/aweme/v1/web/search/sug/?keyword=${encodeURIComponent(kw)}&device_platform=webapp&aid=6383&channel=channel_pc_web`,
    { "user-agent": UA_ENTER, referer: "https://www.douyin.com/" },
  )
  const list = res?.sug_list ?? []
  return list.map((s) => String(s.content ?? "").trim()).filter((s) => s !== "")
}

// ── 搜主播(本地过滤:热门流 + 分区流的 owner.nickname)────────────────────────

/**
 * 搜索主播。⚠️ **没有匿名可用的主播搜索接口**(`aweme/v1/web/live/search` 2483 需登录,
 * 与房间搜索同门槛)。这里走**本地过滤**:抓「热门流 + 命中分区流的房间」,按
 * `owner.nickname` 与关键词匹配(双向包含,大小写不敏感),返回命中主播的**在播房间**。
 *
 * 局限(如实体现在文案):只能命中**当前在播**的主播(离线主播不在任何列表里),
 * 且受限于扫描量(热门 + 前 3 分区)。但零登录、零新接口、匿名可用 ——
 * 补上 `docs/capability-gaps.md` 记的「抖音搜主播未做」。
 *
 * @param anchorName 主播名(或其中片段)
 * @param scan 扫描的房间数上限(热门 + 分区合计)
 */
export async function searchDouyinAnchors(anchorName: string, scan = 90): Promise<Item[]> {
  const name = anchorName.trim().toLowerCase()
  if (!name) return []

  const seen = new Set<string>()
  const pool: Live[] = []
  const collect = (items: Item[]) => {
    for (const it of items as Live[]) {
      if (seen.has(it.roomId)) continue
      seen.add(it.roomId)
      pool.push(it)
    }
  }

  // 1. 综合热门流(partition=720 **type=1**,与 crawler 热门同接口;匿名可用)。
  try {
    collect(await fetchDouyinPartitionRooms("720", "1", 0, Math.min(scan, 60), "live:douyin:anchor"))
  } catch {
    // 热门失败不阻塞:继续扫分区。
  }

  // 2. 命中关键词的分区(与房间搜索同款:上游精确 ∪ 本地树匹配)。
  let parts: DouyinPartition[] = []
  try {
    parts = await searchDouyinPartitions(anchorName)
    const tree = await fetchDouyinCategories()
    for (const p of matchLocalPartitions(tree, anchorName)) {
      if (!parts.some((q) => q.id === p.id)) parts.push(p)
    }
  } catch {
    // 分区不可用:只扫热门。
  }
  for (const p of parts.slice(0, 3)) {
    if (pool.length >= scan) break
    try {
      collect(await fetchDouyinPartitionRooms(p.id, String(p.type), 0, 30, "live:douyin:anchor"))
    } catch {
      // 单分区失败不影响其余。
    }
  }

  // 3. 按 nickname 匹配(双向包含,大小写不敏感)。
  return pool.filter((it) => {
    const n = (it.author?.name ?? "").toLowerCase()
    return n !== "" && (n.includes(name) || name.includes(n))
  })
}
