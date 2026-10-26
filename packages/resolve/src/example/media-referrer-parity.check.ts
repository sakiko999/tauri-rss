/**
 * Referer 规则双份权威守卫 —— `bun packages/resolve/src/example/media-referrer-parity.check.ts`
 *
 * TS（本包 `media-referrer.ts`）是规则权威；Rust 为了 WebView2 拦截回调不能跨语言
 * 调用，在 `apps/src-tauri/src/media_referer.rs` 保留一份常量。两边漏改一边 =
 * 「前端直连了、宿主没加头」→ 图片静默 403。此脚本锁住两份规则一致。
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { MEDIA_REFERRERS, VIDEO_REFERRERS } from "../media-referrer.ts"

const RUST = "apps/src-tauri/src/media_referer.rs"

function rustRules(name: "IMAGE_REFERRERS" | "VIDEO_REFERRERS"): Array<[string, string]> {
  const src = readFileSync(RUST, "utf8")
  const block = src.match(new RegExp(`const ${name}:[^=]*=\\s*&\\[([\\s\\S]*?)\\];`))?.[1]
  assert.ok(block, `Rust 里找不到 ${name}`)
  return [...block!.matchAll(/\("([^"]+)",\s*"([^"]+)"\)/g)].map((m) => [m[1]!, m[2]!])
}

const sorted = (rows: Array<[string, string]>) =>
  [...rows].sort(([a], [b]) => a.localeCompare(b))

assert.deepEqual(sorted(rustRules("IMAGE_REFERRERS")), sorted(MEDIA_REFERRERS), "图片 Referer 规则两边不一致")
assert.deepEqual(sorted(rustRules("VIDEO_REFERRERS")), sorted(VIDEO_REFERRERS), "视频 Referer 规则两边不一致")

console.log("✔ Referer 规则一致性通过（TS resolve/media-referrer.ts ↔ Rust media_referer.rs）")
