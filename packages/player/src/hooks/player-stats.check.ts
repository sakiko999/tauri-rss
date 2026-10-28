/// <reference types="bun" />
/**
 * 播放器「统计信息」纯逻辑自检 —— `bun packages/player/src/hooks/player-stats.check.ts`
 *
 * 判的是格式化/缓冲余量计算(node 侧,不碰 DOM 与引擎)。
 * ⚠️ 三斜线是必要的：player 的 tsconfig 继承 `types: ["vite/client"]`，不会自动加载
 * node/bun 类型，而本文件用 `node:assert`。只给 check 注入，不污染播放器生产代码。
 */
import assert from "node:assert/strict"

import {
  bufferedAhead,
  engineLabel,
  formatBitrate,
  formatBytes,
  formatDropped,
  formatFps,
  formatLevel,
  formatVolume,
} from "../stats.ts"

assert.equal(engineLabel("hls"), "hls.js")
assert.equal(engineLabel("flv"), "flv.js")
assert.equal(engineLabel("dash"), "dash.js")
assert.equal(engineLabel("native"), "原生 <video>")

assert.equal(formatBitrate(undefined), "—")
assert.equal(formatBitrate(0), "—")
assert.equal(formatBitrate(450_000), "450 kbps")
assert.equal(formatBitrate(4_500_000), "4.5 Mbps")

assert.equal(formatLevel({ engine: "hls" }), "—")
assert.equal(
  formatLevel({ engine: "hls", levelIndex: 1, levelCount: 4, height: 1080, bitrate: 4_500_000 }),
  "2/4 · 1080p · 4.5 Mbps",
)
// 档位高度缺失(直播常见)时仍给出下标与码率。
assert.equal(formatLevel({ engine: "hls", levelIndex: 0, levelCount: 3, bitrate: 800_000 }), "1/3 · 800 kbps")

// 当前播放点在第二段缓冲内 → 余量 = 该段末尾 - currentTime。
const ranges = {
  length: 2,
  start: (i: number) => [0, 10][i]!,
  end: (i: number) => [8, 20][i]!,
}
assert.equal(bufferedAhead(ranges, 12), 8)
assert.equal(bufferedAhead(ranges, 5), 3)
// 跳出了所有缓冲段(seeking 中)→ 0,不能算成某段的剩余。
assert.equal(bufferedAhead(ranges, 30), 0)
assert.equal(bufferedAhead({ length: 0, start: () => 0, end: () => 0 }, 1), 0)

assert.equal(formatDropped(3, 1200), "3 / 1200 (0.3%)")
assert.equal(formatDropped(0, 0), "—")

assert.equal(formatBytes(0), "—")
assert.equal(formatBytes(1536), "2 KB")
assert.equal(formatBytes(3.2 * 1024 * 1024), "3.2 MB")

assert.equal(formatFps(undefined), "—")
assert.equal(formatFps(0), "—")
assert.equal(formatFps(29.97), "29.97 fps")

assert.equal(formatVolume(0.8, false), "80%")
assert.equal(formatVolume(0.8, true), "80%（静音）")

console.log("✔ 播放器统计信息自检通过(引擎标签 / 码率 / 档位 / 缓冲余量 / 丢帧 / 流量 / 帧率 / 音量)")
