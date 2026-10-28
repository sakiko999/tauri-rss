/**
 * 「正在直播」筛选自检 —— `bun apps/desktop/src/lib/live-filter.check.ts`
 *
 * 回归背景（2026-10-26）：首页「正在直播 1 个房间」里出现了 twitch 的
 * 「mausleeps（离线）」—— 该渠道对下播频道**有意**保留条目（liveStatus="offline"，
 * 标题带「离线」），而区块筛选只看 kind，于是把离线房间算进了「正在直播」。
 */
import assert from "node:assert/strict"

import type { MediaItem } from "@amoeba/core"

import { isLiveNow } from "./media.ts"

const live = (liveStatus: "live" | "offline" | "unknown"): MediaItem =>
  ({
    kind: "live",
    id: `room-${liveStatus}`,
    subscriptionId: "s1",
    title: liveStatus === "offline" ? "mausleeps（离线）" : "mausleeps",
    url: "https://www.twitch.tv/mausleeps",
    liveStatus,
  }) as MediaItem

// 在播 / 老数据（unknown）算在播
assert.equal(isLiveNow(live("live")), true)
assert.equal(isLiveNow(live("unknown")), true)
// 明确下播 → 不算「正在直播」
assert.equal(isLiveNow(live("offline")), false)

// 非直播条目一律排除
for (const kind of ["video", "audio", "article", "social"] as const) {
  assert.equal(isLiveNow({ kind, id: "x", subscriptionId: "s1" } as MediaItem), false, `${kind} 不是直播`)
}

console.log("✔ 正在直播筛选自检通过（offline 不计入，unknown 保持原行为）")
