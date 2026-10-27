/**
 * 节点 → 主导航映射自检 —— `bun apps/desktop/src/store/nodes.check.ts`
 *
 * 回归背景：合流改版把侧栏「内容类型」重排成 4 个主导航（首页/阅读/动态/影音），
 * 其余节点（tab:all、智能订阅、短视频、页面、分组）保留。节点清单一旦被删/改名、
 * 或 kind→导航的映射漂移，侧栏高亮会静默错位（不报错、只是亮错行）。
 * 本文件把「节点 → 导航」钉死；`navForKind` 与 `navIdOf` 都是纯函数。
 */
import assert from "node:assert/strict"
import type { MediaKind, Subscription } from "@amoeba/core"
import {
  DEFAULT_VIEW,
  HOME_NODE,
  LIBRARY_NODE,
  MAIN_NAV,
  PAGES,
  SHORT_MODES,
  SMART,
  TABS,
  navForKind,
  navIdOf,
  nodeMeta,
} from "./nodes.ts"

const sub = (id: string, channelKey: string, groupId?: string | null): Subscription =>
  ({ id, channelKey, title: id, groupId: groupId ?? null, enabled: true, info: {}, createdAt: 0, updatedAt: 0 }) as Subscription

const KINDS: Record<string, MediaKind> = {
  "bili:video": "video",
  "bili:live": "live",
  "rss:url": "article",
  "xhs:user": "social",
  "apple:podcast-chart": "audio",
  "twitch:categories": "category",
}
const channelKind = (k: string) => KINDS[k]

const subs: Subscription[] = [
  sub("s-video", "bili:video", "g-media"),
  sub("s-video2", "bili:video", "g-media"),
  sub("s-article", "rss:url", "g-mixed"),
  sub("s-social", "xhs:user"),
  sub("s-live", "bili:live", "g-mixed"),
  sub("s-audio", "apple:podcast-chart"),
  sub("s-category", "twitch:categories"),
]
const nav = (id: string | null) => navIdOf(id, subs, channelKind)

// ── 1. kind → 导航 ───────────────────────────────────────────────────────
assert.equal(navForKind("article"), "reader")
assert.equal(navForKind("social"), "social")
for (const k of ["video", "audio", "live"] as const) assert.equal(navForKind(k), "media", `${k} → 影音`)
assert.equal(navForKind("category"), null, "分区目录没有对应导航")
assert.equal(navForKind(undefined), null, "未知 kind 不高亮")

// ── 2. 内容类型节点 ──────────────────────────────────────────────────────
assert.equal(nav("tab:article"), "reader")
assert.equal(nav("tab:social"), "social")
assert.equal(nav("tab:video"), "media")
assert.equal(nav("tab:audio"), "media")
assert.equal(nav("tab:live"), "media")
assert.equal(nav("tab:all"), null, "「全部内容」不属于任何主导航")
assert.equal(nav("tab:not-a-kind"), null, "未知 tab 不高亮而不是抛错")

// ── 3. 保留节点一律不高亮 ────────────────────────────────────────────────
for (const id of ["today", "unread", "starred", "resume", "short:video", "short:live", "page:settings", "page:discover", "page:account", "play:whatever"]) {
  assert.equal(nav(id), null, `${id} 不是主导航`)
}
assert.equal(nav(null), null, "无节点不高亮")
assert.equal(nav(HOME_NODE), "home", "首页节点（M3 新增）")

// ── 4. 订阅节点按 channelKind 派生 ───────────────────────────────────────
assert.equal(nav("s-video"), "media")
assert.equal(nav("s-article"), "reader")
assert.equal(nav("s-social"), "social")
assert.equal(nav("s-live"), "media")
assert.equal(nav("s-audio"), "media")
assert.equal(nav("s-category"), null, "分区订阅不高亮")
assert.equal(nav("s-missing"), null, "未知订阅不高亮")

// ── 5. 分组：成员同属一个导航才高亮 ──────────────────────────────────────
assert.equal(nav("group:g-media"), "media", "同一导航的分组聚合 → 影音")
assert.equal(nav("group:g-mixed"), null, "混组不高亮（否则会亮错一个入口）")
assert.equal(nav("group:g-empty"), null, "空分组不高亮")
assert.equal(nav("group:"), null, "空 gid 不高亮")

// ── 6. 节点清单快照（M0「不可删清单」）────────────────────────────────────
// 合流改版唯一允许的删除是「片库导航位」（P1），其余节点语义必须原样保留：
// P2 拍板全量搬迁，删任一节点都会让某个既有能力失去一级入口。改清单时同步这里。
assert.deepEqual(TABS.map((t) => t.id), ["all", "article", "video", "audio", "live", "social"], "内容类型 tab 六项")
assert.deepEqual(SMART.map((s) => s.id), ["today", "unread", "starred", "resume"], "智能订阅四项")
assert.deepEqual(SHORT_MODES.map((s) => s.kind), ["video", "live"], "短视频两种模式")
assert.deepEqual(PAGES.map((p) => p.id), ["page:discover", "page:account", "page:settings"], "页脚三个页面")
assert.deepEqual(MAIN_NAV.map((n) => n.nodeId), ["home", "tab:article", "tab:social", "tab:video"], "主导航四项")
// 主导航复用既有 tab 节点（旧深链 /v/tab:article 语义不变），不是新 id。
assert.equal(MAIN_NAV[1]!.nodeId, "tab:article")
assert.equal(MAIN_NAV[3]!.nodeId, "tab:video")

// ── 7. 片库深链（P1：不做，但 /library 要落到说明页而不是静默回首页）──────
assert.equal(nav(LIBRARY_NODE), null, "片库不属于主导航（不渲染入口）")
assert.equal(nodeMeta(LIBRARY_NODE, subs, [], channelKind).type, "page", "片库是整页说明")
// 首页分支没有任何其它断言保护：把 HOME_NODE 改名或删掉 nodeMeta 的 home 分支，
// `/` 会退化成「按订阅 id 过滤」→ 假空态，且 nav("home") 那条断言仍绿（只测映射）。
assert.equal(nodeMeta(HOME_NODE, subs, [], channelKind).type, "home", "首页是独立视图意图")
assert.equal(nodeMeta(null, subs, [], channelKind).type, "home", "无节点兜底到首页")
assert.equal(DEFAULT_VIEW, HOME_NODE, "默认落地视图是首页")

console.log("✔ 节点 → 主导航映射自检通过（4 导航 + 保留节点 + 分组/订阅派生 + 节点清单快照）")
