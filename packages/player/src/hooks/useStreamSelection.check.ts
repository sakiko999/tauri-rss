/**
 * 选流契约自检 —— 默认选流必须命中 crawler 契约的「最高清晰度」(= streams[0])。
 *
 * 跑:`bun packages/player/src/hooks/useStreamSelection.check.ts`
 *
 * ⚠️ 为什么单列:选流错了**不报错**,只是画质静默变低 —— 没人会发现。
 * 旧实现按**格式族**挑(渐进式 → hls → flv → 兜底),一旦首档不是渐进式、
 * 后面却有,就会跳过低档去取那个渐进式。
 */
import assert from "node:assert/strict"
import type { MediaStream } from "@amoeba/core"
import { pickDefaultStream } from "./streamKind.ts"

const s = (format: string, url: string): MediaStream => ({ url, format }) as MediaStream

// ── 1. huya 形态:每档 hls 在前、flv 在后,首档即最高档 ──────────────────────
assert.equal(
  pickDefaultStream([s("hls", "a/top.m3u8"), s("flv", "a/top.flv"), s("hls", "a/low.m3u8")])?.url,
  "a/top.m3u8",
  "首档(最高清晰度)应当被选中",
)

// ── 2. ⭐ 首档 dash + 次档 360p mp4:旧实现翻车的地方 ─────────────────────────
// 旧写法 `find(isProgressiveVideo)` 会把 360p 的 mp4 挑走。
{
  const streams = [s("dash", "a/1080p.mpd"), s("mp4", "a/360p.mp4")]
  assert.equal(pickDefaultStream(streams)?.url, "a/1080p.mpd", "首档 dash 是最高档,不能被后面的 360p mp4 抢走")
}

// ── 3. 首档 flv + 次档 hls:旧实现在 hls 分支就跳走了 ───────────────────────
assert.equal(
  pickDefaultStream([s("flv", "a/top.flv"), s("hls", "a/low.m3u8")])?.url,
  "a/top.flv",
  "首档 flv 是最高档,不能被后面的 hls 抢走",
)

// ── 4. douyu 形态:全 flv(无 hls / 无渐进式)─────────────────────────────────
assert.equal(
  pickDefaultStream([s("flv", "a/2k60.flv"), s("flv", "a/8m.flv")])?.url,
  "a/2k60.flv",
  "douyu 的 rate 是服务端档位 ID,不能按数值排序 —— 只认数组顺序",
)

// ── 5. 播客单流 ──────────────────────────────────────────────────────────
assert.equal(pickDefaultStream([s("audio/mpeg", "a/ep.mp3")])?.url, "a/ep.mp3")

// ── 6. 空数组(无可播流)────────────────────────────────────────────────
assert.equal(pickDefaultStream([]), undefined)

console.log("✔ 选流契约自检通过(默认选流 = streams[0],不被格式族抢走)")
