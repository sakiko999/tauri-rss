/**
 * 首页聚合 selectors 自检 —— `bun apps/desktop/src/store/selectors.check.ts`
 *
 * 这五个函数是「合流」首页五个区块的唯一数据源，全在客户端镜像上算。
 * 最容易静默错的三处：今日计数漏掉无 publishedAt 的源、续播进度用错时长字段、
 * 「正在直播」把 offline 房间算进去——各自有用例钉死。
 */
import assert from "node:assert/strict"
import type { MediaItem, Subscription } from "@amoeba/core"
import { groupedBySub, picksMix, queryView, resumeWithPct, selectLive, todayCounts } from "./selectors.ts"

const NOW = new Date("2026-10-27T12:00:00").getTime()
const HOUR = 3600_000
const DAY = 24 * HOUR

type Extra = Record<string, unknown>
const item = (id: string, kind: MediaItem["kind"], sub: string, extra: Extra = {}): MediaItem =>
  ({ id, kind, subscriptionId: sub, title: id, fetchedAt: NOW, ...extra }) as MediaItem

const sub = (id: string): Subscription =>
  ({ id, channelKey: "x", title: id, groupId: null, enabled: true, info: {}, createdAt: 0, updatedAt: 0 }) as Subscription

// ── 1. 今日计数 ──────────────────────────────────────────────────────────
{
  const items = [
    item("a1", "article", "s1", { publishedAt: NOW - 2 * HOUR }),
    item("v1", "video", "s1", { publishedAt: NOW - 3 * HOUR }),
    item("a0", "article", "s1", { publishedAt: NOW - DAY - 1 }), // 昨天
    item("no-ts", "article", "s1"), // 无时间戳：不计入今日，但也不报错
    item("l1", "live", "s2", { liveStatus: "live" }),
    item("l2", "live", "s2", { liveStatus: "unknown" }), // 老数据按在播
    item("l3", "live", "s2", { liveStatus: "offline" }),
  ]
  const c = todayCounts(items, NOW)
  assert.equal(c.total, 2, "今日只算 publishedAt 落在今天的")
  assert.equal(c.byKind.article, 1)
  assert.equal(c.byKind.video, 1)
  assert.equal(c.liveNow, 2, "在播 = live/unknown，offline 不算")
}

// ── 2. 续播进度 ──────────────────────────────────────────────────────────
{
  const items = [
    item("v-duration", "video", "s1", { positionSec: 300, duration: 600, lastReadAt: NOW - 1 * HOUR }),
    item("v-durationSec", "video", "s1", { positionSec: 250, durationSec: 500, lastReadAt: NOW - 2 * HOUR }),
    item("v-no-duration", "video", "s1", { positionSec: 100, lastReadAt: NOW - 3 * HOUR }),
    item("a-half", "article", "s1", { scrollRatio: 0.25, lastReadAt: NOW - 4 * HOUR }),
    item("a-clamp", "article", "s1", { scrollRatio: 1.2, lastReadAt: NOW - 5 * HOUR }),
    item("l-progress", "live", "s2", { positionSec: 100, online: 999 }),
    item("v-done", "video", "s1", { positionSec: 0, duration: 600 }),
  ]
  const r = resumeWithPct(items)
  assert.deepEqual(
    r.map((x) => x.item.id),
    ["v-duration", "v-durationSec", "a-half", "a-clamp"],
    "按 lastReadAt 降序；缺时长的视频/直播/零进度全部剔除",
  )
  assert.equal(r[0]?.pct, 0.5, "duration 字段也算（bili 只写 duration）")
  assert.equal(r[1]?.pct, 0.5, "durationSec 兜底")
  assert.equal(r[2]?.pct, 0.25, "文章用 scrollRatio")
  assert.equal(r[3]?.pct, 1, "进度裁剪到 1")
}

// ── 3. 在播直播 ──────────────────────────────────────────────────────────
{
  const items = [
    item("off", "live", "s1", { liveStatus: "offline", online: 99999 }),
    item("low", "live", "s1", { liveStatus: "live", online: 10 }),
    item("high", "live", "s1", { liveStatus: "live", online: 900 }),
    item("old", "live", "s1", { liveStatus: "unknown" }),
    item("vid", "video", "s1", { online: 500 }),
  ]
  const r = selectLive(items)
  assert.deepEqual(r.map((x) => x.id), ["high", "low", "old"], "offline 排除、在线数降序、unknown 兜底在后")
  assert.equal(selectLive(items, 2).length, 2, "limit 生效")
}

// ── 4. 订阅更新 ──────────────────────────────────────────────────────────
{
  const subs = [sub("s1"), sub("s2"), sub("s-empty")]
  const items = [
    item("s1-old", "article", "s1", { publishedAt: NOW - 10 * HOUR, isUnread: false }),
    item("s1-new", "article", "s1", { publishedAt: NOW - 1 * HOUR, isUnread: true }),
    item("s2-new", "video", "s2", { publishedAt: NOW - 2 * HOUR }),
  ]
  const r = groupedBySub(items, subs, 1)
  assert.deepEqual(r.map((x) => x.sub.id), ["s1", "s2"], "按最新一条排序；空订阅不出现")
  assert.deepEqual(r[0]?.items.map((x) => x.id), ["s1-new"], "每个订阅截断到 perSub")
  assert.equal(r[0]?.unread, 1, "未读数是该订阅全量，不是截断后的")
  assert.equal(r[1]?.unread, 0)
}

// ── 5. 精选混排 ──────────────────────────────────────────────────────────
{
  const items = [
    item("s-low", "social", "s1", { likes: 10 }),
    item("s-high", "social", "s1", { likes: 900 }),
    item("v-new", "video", "s1", { publishedAt: NOW - 1 * HOUR }),
    item("v-old", "video", "s1", { publishedAt: NOW - 9 * HOUR }),
    item("a1", "article", "s1", { publishedAt: NOW }),
  ]
  const r = picksMix(items, 3)
  assert.deepEqual(r.map((x) => x.id), ["s-high", "v-new", "s-low"], "动态按热度、影音按时间、交替取；文章不进精选")
  assert.equal(picksMix(items, 99).length, 4, "limit 大于池子时取尽可用的")
}

// ── 6. 阅读筛选：两个条件同时置位 = AND ──────────────────────────────────
{
  const items = [
    item("both", "article", "s1", { isUnread: true, isStarred: true }),
    item("unread", "article", "s1", { isUnread: true, isStarred: false }),
    item("starred", "article", "s1", { isUnread: false, isStarred: true }),
  ]
  const slice = {
    allItems: items,
    subscriptions: [],
    filter: { "tab:all": { unreadOnly: true, starredOnly: true } },
    sort: {},
    page: {},
    query: "",
    selectedNodeId: "tab:all",
    refreshErrors: {},
  }
  assert.deepEqual(queryView(slice, "tab:all", NOW).list.map((x) => x.id), ["both"], "未读+收藏同时置位是 AND")
}

console.log("✔ 首页聚合 selectors 自检通过（今日/续播/在播/订阅更新/精选/筛选）")
