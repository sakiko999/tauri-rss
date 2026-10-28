/**
 * 渠道目录 —— 「添加订阅」弹窗浏览步骤的纯计算：分类 / 搜索 / 分组 / 分页。
 *
 * 92 个渠道铺成一片 chip 是不可读的（原型把它改成了「分类 + 搜索 + 行式列表」），
 * 但渲染留在 `AddPanels.tsx`，这里只出数据。三个数各错一次都是静默的：
 * 分类计数、搜索过滤、分页边界（首组永远要显示，否则「显示更多」点下去还是 0 行）。
 * 回归 `channel-catalog.check.ts`。
 */

import type { ChannelInfo } from "@amoeba/core"
import { platformDef } from "@amoeba/platform"

import { platformOf } from "./subscriptions.ts"

/** 分类展示顺序：视频/直播平台在前，通用 RSS 与 RSSHub 收尾。 */
const CATEGORY_ORDER = [
  "bili",
  "youtube",
  "twitch",
  "huya",
  "douyu",
  "douyin",
  "weibo",
  "xhs",
  "apple",
  "rss",
  "rsshub",
]

/** 平台表里没有的 key 前缀（`rss:` 直链）单独成一类，名字只能在这里给。 */
const CATEGORY_LABEL: Record<string, string> = { rss: "RSS 与播客" }

/** 一屏最多渲染多少行渠道（按组累加，不切断组）。 */
export const CATALOG_PAGE = 24

/** 渠道 → 分类 id（登记过走平台表，rss: 直链退回 key 首段）。 */
export function categoryOf(channel: ChannelInfo): string {
  return platformOf(channel.key)
}

export function categoryLabel(id: string): string {
  return CATEGORY_LABEL[id] ?? platformDef(id)?.label ?? id
}

/**
 * 无参渠道 = 单例：一个渠道只该有一条订阅（再订阅就是同一份内容）。
 * 有参数的可以反复添加 —— 每个 UP 主 / 收藏夹都是独立一条。
 */
export function isSingleton(channel: ChannelInfo): boolean {
  return !(channel.sourceInfoTpl?.length ?? 0)
}

export interface CatalogCategory {
  id: string
  label: string
  /** 该分类的渠道总数（与搜索无关，搜索时 tab 上的数字不能跳动）。 */
  count: number
}

export interface CatalogGroup {
  id: string
  label: string
  items: ChannelInfo[]
}

export interface CatalogView {
  /** 分类 tab，首项恒为「全部渠道」。 */
  cats: CatalogCategory[]
  /** 当前可见的组（按分类顺序，已按 limit 截断）。 */
  groups: CatalogGroup[]
  /** 命中总数。 */
  total: number
  /** 已渲染行数；`total - shown` = 「显示更多」上的剩余数。 */
  shown: number
}

/** 出现过的分类，按 CATEGORY_ORDER 排；未登记的附加在末尾（按注册顺序）。 */
function orderedCategories(channels: ChannelInfo[]): string[] {
  const seen = new Set(channels.map(categoryOf))
  const ids = CATEGORY_ORDER.filter((id) => seen.has(id))
  for (const id of seen) if (!ids.includes(id)) ids.push(id)
  return ids
}

/**
 * @param cat  分类 id，`"all"` = 不筛
 * @param query 匹配渠道名 / key / 分类名（key 不展示，但 "bili" 这类缩写值得能搜到）
 * @param limit 最多渲染多少行（整组累加；第一组无论如何都渲染）
 */
export function catalogView(channels: ChannelInfo[], cat = "all", query = "", limit = CATALOG_PAGE): CatalogView {
  const ids = orderedCategories(channels)
  const cats: CatalogCategory[] = [
    { id: "all", label: "全部渠道", count: channels.length },
    ...ids.map((id) => ({
      id,
      label: categoryLabel(id),
      count: channels.filter((c) => categoryOf(c) === id).length,
    })),
  ]

  const q = query.trim().toLowerCase()
  const matched = channels.filter((c) => {
    if (cat !== "all" && categoryOf(c) !== cat) return false
    if (!q) return true
    return `${c.name} ${c.key} ${categoryLabel(categoryOf(c))}`.toLowerCase().includes(q)
  })

  const groups: CatalogGroup[] = []
  let shown = 0
  for (const id of ids) {
    const items = matched.filter((c) => categoryOf(c) === id)
    if (!items.length) continue
    // 第一组永远渲染：否则 limit 小于首组大小时，「显示更多」永远只多出 0 行。
    if (groups.length > 0 && shown + items.length > limit) break
    groups.push({ id, label: categoryLabel(id), items })
    shown += items.length
  }
  return { cats, groups, total: matched.length, shown }
}
