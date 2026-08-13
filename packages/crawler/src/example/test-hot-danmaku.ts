/**
 * test-hot-danmaku —— 热门直播 channel 找开播房间 → 逐个测弹幕。
 *
 * 流程:fetch 4 个热门 channel(bili:live:hot / live:douyu:hot / live:huya:hot /
 * live:douyin:hot)→ 解析 XML 拿 roomId 列表 → 对每个平台前 N 个房间,用单房间
 * channel 的 getDanmaku(roomId) 订阅几秒收弹幕(验证各平台弹幕在有开播房间时通)。
 *
 * Run: bun run packages/crawler/src/example/test-hot-danmaku.ts [seconds] [perPlatform]
 */
import { getChannel, isDanmakuPlayable, type SourceInfo } from "../index.ts"
import { parseFeed } from "../../../xml/src/xml-parser.ts"
import { setupBackends } from "./backend.ts"
import { DEFAULT_BILIBILI_COOKIE } from "../../../core/src/bilibili-cookie.ts"

/** [热门 channel key, 单房间弹幕 channel key]。 */
const HOT: Array<[string, string]> = [
  ["bili:live:hot", "bili:live"],
  ["live:douyu:hot", "live:douyu"],
  ["live:huya:hot", "live:huya"],
  ["live:douyin:hot", "live:douyin"],
]

async function main() {
  setupBackends()
  const seconds = Number(process.argv[2] ?? 4)
  const perPlatform = Number(process.argv[3] ?? 3)
  for (const [hotKey, roomKey] of HOT) {
    const hotCh = getChannel(hotKey)
    if (!hotCh) {
      console.log(`❌ ${hotKey}: 未知 channel`)
      continue
    }
    let rooms: string[] = []
    try {
      const hotInfo: SourceInfo = hotKey === "bili:live:hot" ? { cookie: DEFAULT_BILIBILI_COOKIE } : {}
      const xml = await hotCh.getSource(hotInfo).fetch()
      const feed = parseFeed(xml)
      rooms = feed.channel.item.map((i) => String((i.raw as Record<string, unknown> | undefined)?.["tpl:roomId"] ?? "")).filter(Boolean)
    } catch (e) {
      console.log(`⚠️ ${hotKey}: 热门列表失败: ${(e as Error).message}`)
      continue
    }
    const preview = rooms.slice(0, 6).join(", ")
    console.log(`\n${hotKey}: ${rooms.length} 个开播房间: ${preview}${rooms.length > 6 ? "…" : ""}`)

    const roomCh = getChannel(roomKey)
    if (!roomCh) continue
    const info: SourceInfo = roomKey === "bili:live" ? { cookie: DEFAULT_BILIBILI_COOKIE } : {}
    const source = roomCh.getSource(info)
    if (!isDanmakuPlayable(source)) {
      console.log(`  ⚠️ ${roomKey} 不支持弹幕`)
      continue
    }
    for (const rid of rooms.slice(0, perPlatform)) {
      let count = 0
      const sample: string[] = []
      const unsub = source.getDanmaku(rid)((batch) => {
        count += batch.length
        for (const d of batch) if (sample.length < 3) sample.push(`${d.user ?? ""}: ${d.text}`)
      })
      await new Promise((r) => setTimeout(r, seconds * 1000))
      unsub()
      console.log(`  ${roomKey} 房间 ${rid}: ${count} 条弹幕 ${sample.length ? "| " + sample.join(" · ") : ""}`)
    }
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("❌ probe failed:", e)
  process.exit(1)
})
