/**
 * resolve —— 懒解析播放流(video + live 合一)。
 *
 * 探测 source 能力分流:isRssVideoSource → fetch 取首个 item id → resolvePlay;
 * isRssLiveSource → resolveLivePlay(roomId)。bili 注入 core 默认 cookie(登录档位)。
 *
 * Run: bun run packages/crawler/src/example/resolve.ts [channel] [id]
 *   channel  可选:channel key(默认 bili:popular,video)
 *   id       可选:video 省略时取首个 item;live 传房间号(默认 exampleInfo)
 */
import { parseFeed, type Stream } from "@tauri-playground/xml"
import { getChannel, isRssLiveSource, isRssVideoSource } from "../index.ts"
import { setupBackends, exampleInfo } from "./backend.ts"
import { DEFAULT_BILIBILI_COOKIE } from "../../../core/src/bilibili-cookie.ts"

async function main() {
  setupBackends()
  const key = process.argv[2] ?? "bili:popular"
  const ch = getChannel(key)
  if (!ch) throw new Error(`unknown channel: ${key}`)
  const cookie = key.startsWith("bili:") ? DEFAULT_BILIBILI_COOKIE : undefined
  const info = { ...exampleInfo(key), ...(cookie ? { cookie } : {}) }
  const source = ch.getSource(info)
  console.log(`channel: ${key}  ${ch.name}`)

  // video:fetch 取首个 item id → resolvePlay。
  if (isRssVideoSource(source)) {
    const xml = await source.fetch()
    const item = parseFeed(xml).channel.item[0]
    if (!item) throw new Error(`channel ${key}: no items`)
    const itemId = item.guid ?? item.link ?? ""
    console.log(`item:    ${item.title ?? "(untitled)"}`)
    console.log(`id:      ${itemId}`)
    const streams = await source.resolvePlay(itemId)
    return printStreams(streams)
  }
  // live:resolveLivePlay(roomId)。
  if (isRssLiveSource(source)) {
    const roomId = process.argv[3] ?? exampleInfo(key).roomId ?? ""
    console.log(`room:    ${roomId || "(default)"}`)
    const streams = await source.resolveLivePlay(roomId)
    return printStreams(streams)
  }
  throw new Error(`channel ${key} 无 resolvePlay/resolveLivePlay 能力`)
}

function printStreams(streams: Stream[]): void {
  console.log(`streams: ${streams.length} 条`)
  for (const [i, s] of streams.entries()) {
    const q = s.quality ? `${s.quality} ` : ""
    const url = s.url ?? ""
    console.log(`  [${i}] ${q}${s.format ?? ""} ${url.slice(0, 110)}${url.length > 110 ? "…" : ""}`)
    if (s.headers) console.log(`      headers: ${JSON.stringify(s.headers)}`)
  }
}

main().catch((err) => {
  console.error("❌ example failed:", err)
  process.exit(1)
})
