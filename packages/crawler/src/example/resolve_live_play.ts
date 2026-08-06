/**
 * resolve_live_play —— 验证 live channel 的懒解析播放能力。
 * 取指定 live channel 的 source,调 resolveLivePlay(roomId) → 真实播放流。
 *
 * Run: bun run packages/crawler/src/example/resolve_live_play.ts [channel] [roomId]
 *   channel  可选:channel key(默认 live:douyu)
 *   roomId   可选:房间号(默认按 channel 取 exampleInfo)
 *
 * 已实测可用的房间:
 *   live:douyu 9999     → RTMP/FLV 直链
 *   bili:live 6         → FLV + HLS(m3u8)直链
 *   live:douyin 1       → 示例房间,未开播时 0 条(需换直播中房间)
 */
import { getChannel, isRssLiveChannel } from "../index.ts"
import { setupBackends, exampleInfo } from "./backend.ts"

async function main() {
  setupBackends()
  const key = process.argv[2] ?? "live:douyu"
  const roomId = process.argv[3] ?? exampleInfo(key).roomId ?? ""
  const ch = getChannel(key)
  if (!ch) throw new Error(`unknown channel: ${key}`)
  if (!isRssLiveChannel(ch)) throw new Error(`channel ${key} does not support lazy live play resolution`)

  console.log(`channel: ${key}  ${ch.name}`)
  console.log(`room:    ${roomId || "(default)"}`)
  const streams = await ch.resolveLivePlay(roomId)
  console.log(`streams: ${streams.length} 条`)
  for (const [i, s] of streams.entries()) {
    console.log(`  [${i}] ${s.format} ${s.url.slice(0, 110)}${s.url.length > 110 ? "…" : ""}`)
    if (s.headers) console.log(`      headers: ${JSON.stringify(s.headers)}`)
  }
}

main().catch((err) => {
  console.error("❌ example failed:", err)
  process.exit(1)
})
