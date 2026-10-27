/**
 * 渠道目录自检 —— `bun apps/desktop/src/lib/channel-catalog.check.ts`
 *
 * 钉三处：分类计数不受搜索影响、分类顺序稳定（RSS 收尾）、分页永远至少出一组。
 * 这三条错了都不会报错，只会让「显示更多」变成死按钮或让 tab 数字乱跳。
 */
import assert from "node:assert/strict"
import type { ChannelInfo } from "@amoeba/core"
import { CATALOG_PAGE, catalogView, isSingleton } from "./channel-catalog.ts"

const ch = (key: string, name: string, need?: string[]): ChannelInfo =>
  ({
    key,
    name,
    kind: "video",
    loginable: false,
    passive: false,
    ...(need ? { sourceInfoTpl: need.map((k) => ({ key: k, label: k, required: true })) } : {}),
  }) as ChannelInfo

const CATALOG = [
  ch("rss:url", "RSS 直链", ["url"]),
  ch("rss:podcast", "播客 RSS", ["url"]),
  ch("bili:popular", "B站综合热门"),
  ch("bili:user_video", "B站 UP 主投稿", ["uid"]),
  ch("bili:live", "B站直播房间", ["roomIds"]),
  ch("youtube", "YouTube 频道", ["channelId"]),
  ch("live:huya", "虎牙直播房间", ["roomIds"]),
  ch("douyin:trend", "抖音热点榜"),
]

// ── 1. 分类：顺序 / 标签 / 计数 ─────────────────────────────────────────
{
  const v = catalogView(CATALOG)
  assert.deepEqual(
    v.cats.map((c) => c.id),
    ["all", "bili", "youtube", "huya", "douyin", "rss"],
    "直播/视频平台在前，RSS 收尾；「全部渠道」恒为第一项",
  )
  assert.equal(v.cats[0]?.count, 8)
  assert.equal(v.cats[1]?.count, 3, "B站 3 个渠道")
  assert.equal(v.cats.find((c) => c.id === "rss")?.label, "RSS 与播客", "rss: 前缀不在平台表里，标签要单独给")
  assert.equal(v.cats.find((c) => c.id === "huya")?.label, "虎牙", "其余分类名取自平台表")
}

// ── 2. 搜索：渠道名 / key / 平台名 都能命中 ──────────────────────────────
{
  assert.equal(catalogView(CATALOG, "all", "up 主").total, 1, "按渠道名匹配（大小写无关）")
  assert.equal(catalogView(CATALOG, "all", "huya").total, 1, "按 key 匹配：中文名里没有平台拼写")
  assert.equal(catalogView(CATALOG, "all", "b站").total, 3, "按平台名匹配")
  assert.equal(catalogView(CATALOG, "all", "   ").total, 8, "空白查询等于不筛")
  assert.equal(catalogView(CATALOG, "all", "不存在的渠道").total, 0)
  // 搜索在分类内进行（原型的「在全部渠道中搜索」靠调用方切 cat）
  assert.equal(catalogView(CATALOG, "bili", "youtube").total, 0, "分类优先于搜索")
  // tab 上的计数不受搜索影响，否则数字会随输入跳动
  assert.equal(catalogView(CATALOG, "all", "b站").cats[1]?.count, 3)
}

// ── 3. 分组与分页 ───────────────────────────────────────────────────────
{
  const v = catalogView(CATALOG, "all")
  assert.deepEqual(v.groups.map((g) => g.id), ["bili", "youtube", "huya", "douyin", "rss"])
  assert.deepEqual(v.groups[0]?.items.map((c) => c.key), ["bili:popular", "bili:user_video", "bili:live"], "组内保持注册顺序")
  assert.equal(v.shown, v.total, "默认 limit 足够时全量渲染")

  // 三组各 6 条，limit=10：整组累加 → 只出第一组（6），剩 12 条
  const wide = Array.from({ length: 18 }, (_, i) =>
    ch(`${["bili", "youtube", "huya"][Math.floor(i / 6)]}:x${i}`, `渠道 ${i}`),
  )
  const paged = catalogView(wide, "all", "", 10)
  assert.equal(paged.groups.length, 1, "不切断组：第二组会越界就不渲染")
  assert.equal(paged.shown, 6)
  assert.equal(paged.total - paged.shown, 12, "「显示更多」剩余数")
  assert.equal(catalogView(wide, "all", "", 100).shown, 18, "limit 足够时全出")

  // 首组比 limit 还大：仍要渲染，否则「显示更多」永远点不出内容
  const big = Array.from({ length: 30 }, (_, i) => ch(`bili:x${i}`, `渠道 ${i}`))
  const first = catalogView(big, "all", "", 5)
  assert.equal(first.shown, 30, "首组恒定渲染")
  assert.equal(first.total - first.shown, 0)
}

// ── 4. 单例判定 ─────────────────────────────────────────────────────────
{
  assert.equal(isSingleton(ch("bili:popular", "B站综合热门")), true, "无参渠道 = 单例")
  assert.equal(isSingleton(ch("bili:user_video", "B站 UP 主投稿", ["uid"])), false, "带参数可反复添加")
  assert.equal(isSingleton({ key: "x", name: "x", kind: "video", loginable: false, passive: false, sourceInfoTpl: [] } as ChannelInfo), true, "空数组也算单例")
  assert.equal(CATALOG_PAGE, 24)
}

console.log("✔ 渠道目录自检通过（分类/搜索/分组分页/单例）")
