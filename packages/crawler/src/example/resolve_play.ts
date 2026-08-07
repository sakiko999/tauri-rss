/**
 * resolve_play —— 验证 bili video channel 的懒解析播放能力。
 * 取 bili:popular 首个 video item(bvid),调 channel.resolvePlay(bvid) → 真实 mp4 直链。
 *
 * Run: bun run packages/crawler/src/example/resolve_play.ts [channel]
 *   channel  可选:channel key(默认 bili:popular)
 */
import { parseFeed } from "@tauri-playground/xml"
import { getChannel, isRssVideoSource } from "../index.ts"
import { setupBackends, exampleInfo } from "./backend.ts"

async function main() {
  setupBackends()
  const key = process.argv[2] ?? "bili:popular"
  const ch = getChannel(key)
  if (!ch) throw new Error(`unknown channel: ${key}`)

  // fetch → 解析第一个 video item 的 id(bili 为 bvid ?? av{aid})。
  const source = ch.getSource(exampleInfo(key))
  const xml = await source.fetch()
  const feed = parseFeed(xml)
  const item = feed.channel.item[0]
  if (!item) throw new Error(`channel ${key}: no items`)
  const itemId = item.guid ?? item.link ?? ""
  console.log(`channel: ${key}  ${ch.name}`)
  console.log(`item:    ${item.title ?? "(untitled)"}`)
  console.log(`id:      ${itemId}`)

  // 懒解析可播流。能力在 source 上:探测是否有 resolvePlay(不依赖 kind)。
  if (!isRssVideoSource(source)) {
    throw new Error(`channel ${key} does not support video play resolution`)
  }
  const streams = await source.resolvePlay(itemId)
  console.log(`streams: ${streams.length} 条`)
  for (const [i, s] of streams.entries()) {
    console.log(`  [${i}] ${s.format} ${s.url}`)
    if (s.headers) console.log(`      headers: ${JSON.stringify(s.headers)}`)
  }
}

main().catch((err) => {
  console.error("❌ example failed:", err)
  process.exit(1)
})
