/**
 * test-ws-douyin —— 验证 douyin 直播弹幕握手打通。
 *
 * 前置:node host 已注入 appHost.ws(nodeWsBackend,ws 包带 header)。
 * 流程:douyin 热门前 1-2 房间 → getDanmaku(roomId) 订阅几秒 → 打印弹幕。
 * douyin 弹幕必须带 UA/Cookie/Origin 握手 header(残缺 cookie 417、陈旧 ttwid 415),
 * 浏览器原生 WS 做不到 —— 本脚本验证 node ws 包带 header 能否通。
 *
 * Run: bun run packages/crawler/src/example/test-ws-douyin.ts [seconds]
 */
import { setupBackends } from "./backend.ts"
import { getChannel, isDanmakuPlayable } from "../index.ts"
import { parseFeed } from "../../../xml/src/xml-parser.ts"

async function main() {
  setupBackends()
  const seconds = Number(process.argv[2] ?? 8)

  // 1. douyin 热门前 2 房间(开播中)。
  const hot = getChannel("live:douyin:hot")
  if (!hot) {
    console.log("❌ live:douyin:hot 未知")
    process.exit(1)
  }
  const xml = await hot.getSource({}).fetch()
  const rooms = parseFeed(xml).channel.item
    .map((i) => String((i.raw as Record<string, unknown> | undefined)?.["tpl:roomId"] ?? ""))
    .filter(Boolean)
    .slice(0, 2)
  console.log(`douyin 热门房间: ${rooms.join(", ")}`)
  if (!rooms.length) {
    console.log("⚠️ 无开播房间")
    process.exit(0)
  }

  const ch = getChannel("live:douyin")
  const source = ch?.getSource({})
  if (!ch || !source || !isDanmakuPlayable(source)) {
    console.log("❌ live:douyin 不支持弹幕")
    process.exit(1)
  }

  for (const roomId of rooms) {
    let count = 0
    const sample: string[] = []
    const unsub = source.getDanmaku(roomId)((batch) => {
      count += batch.length
      for (const d of batch) if (sample.length < 5) sample.push(`${d.user ?? ""}: ${d.text}`)
    })
    await new Promise((r) => setTimeout(r, seconds * 1000))
    unsub()
    console.log(`\n房间 ${roomId}: ${count} 条弹幕`)
    for (const s of sample) console.log(`  ${s}`)
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("❌ failed:", e)
  process.exit(1)
})
