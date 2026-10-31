/**
 * 全量导出自检 —— `bun apps/desktop/src/lib/data-export.check.ts`
 *
 * 守两件事：① 导出文件里不能出现明文 cookie；② 阅读态（已读/星标/进度）不能漏。
 * 导出文件会落到系统下载目录，漏凭证等于把登录态写进用户看得到的地方。
 */

import assert from "node:assert/strict"

import type { AppSettings, MediaItem, Subscription } from "@amoeba/core"

import { buildDataExport, type DataExport } from "./data-export.ts"

const subs = [
  {
    id: "s1",
    channelKey: "bili:live",
    title: "B站直播",
    enabled: true,
    // 订阅级凭证：core 明确支持 info.cookie（调用点显式值优先于 settings 快照）。
    info: { roomIds: "1,2", cookie: "SESSDATA=sub-secret" },
    createdAt: 0,
    updatedAt: 0,
  },
] as Subscription[]
const settings = {
  theme: "system",
  bilibiliCookie: "SESSDATA=secret",
  weiboCookie: "SUB=secret",
  refreshIntervalMin: 30,
} as unknown as AppSettings
const items = [
  { id: "a", subscriptionId: "s1", kind: "article", isUnread: true },
  { id: "b", subscriptionId: "s1", kind: "article", isUnread: false },
  { id: "c", subscriptionId: "s1", kind: "video", isUnread: true, isStarred: true, positionSec: 42 },
  { id: "d", subscriptionId: "s1", kind: "article", isUnread: true, scrollRatio: 0.4 },
] as unknown as MediaItem[]

const text = buildDataExport({ subscriptions: subs, groups: [], items, settings, now: 1_700_000_000_000 })
const data = JSON.parse(text) as DataExport & { settings: Record<string, unknown> }

assert.ok(!text.includes("secret"), "导出内容不得包含明文 cookie 值（settings 或订阅 info）")
assert.ok(!Object.keys(data.settings).some((k) => k.endsWith("Cookie")), "settings 里的 *Cookie 字段必须剔除")
assert.equal(data.settings.theme, "system", "非凭证设置应保留")
assert.equal(data.credentialsOmitted, true, "要显式标记凭证已剔除")
assert.equal(data.subscriptions[0]?.info?.cookie, undefined, "订阅 info.cookie 必须剔除")
assert.equal(data.subscriptions[0]?.info?.roomIds, "1,2", "订阅 info 的非凭证字段应保留")

const ids = data.reading.map((r) => r.itemId).sort()
assert.deepEqual(ids, ["b", "c", "d"], "只导出有阅读态的条目（未读且无进度/星标的不导出）")
const c = data.reading.find((r) => r.itemId === "c")
assert.equal(c?.positionSec, 42, "续播位置要导出")
assert.equal(c?.isStarred, true, "星标要导出")
assert.equal(data.reading.find((r) => r.itemId === "b")?.isUnread, false, "已读状态要导出")

console.log("✔ 全量导出自检通过（凭证剔除 / 阅读态完整 / 跳过未触碰条目）")
