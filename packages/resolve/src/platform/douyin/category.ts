/**
 * 抖音直播分区 —— 首页 SSR 的 `categoryData` 解析。
 *
 * 复刻 pure_live `douyin_site.dart:111 extractCategoryDataJson`:SSR 里的
 * `{"pathname":"/","categoryData":[...]}` 是**转义进 JSON 字符串**的,需
 * 平衡大括号截取 + `\"`→`"` / `\\`→`\` 反转义,再 JSON.parse。
 *
 * 结构(实测 2026-09):
 *   categoryData[] = { partition: {id_str, type, title}, sub_partition?: [...] }
 *   顶层 8 个(聊天/音乐/游戏/二次元/舞蹈/文化/生活/运动),仅"游戏"带 7 个子分区。
 *
 * ⚠️ **partition_type 不是常量**——顶层分区 type=4、子分区 type=1。列房间
 * (`partition/detail/room/v2`)必须带上对应 type,否则取不到数据。这也是
 * `channels/douyin/hot.ts` 硬编码 `type=1` 的原因(它在直接列子分区层)。
 */
import { httpText } from "../../host.ts"
import { UA_ENTER } from "./abogus.ts"

const LIVE = "https://live.douyin.com"

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
