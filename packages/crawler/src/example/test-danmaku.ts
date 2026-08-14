/**
 * test-danmaku —— 四平台直播弹幕回归(热门列表保证在播房间)。
 *
 * 对 bili/douyu/huya/douyin 的 hot channel fetch 拿开播房间列表,逐个订阅 N 秒收弹幕。
 * 用热门列表而非固定房间——离线房间 0 条不代表失败,热门保证在播。
 * bili 带 core 默认登录 cookie(2026 风控:直播弹幕需真实登录 uid)。
 *
 * Run: bun run packages/crawler/src/example/test-danmaku.ts [seconds] [perPlatform]
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
  const seconds = Number(process.argv[2] ?? 5)
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
      rooms = parseFeed(xml).channel.item
        .map((i) => String((i.raw as Record<string, unknown> | undefined)?.["tpl:roomId"] ?? ""))
        .filter(Boolean)
    } catch (e) {
      console.log(`⚠️ ${hotKey}: 热门列表失败: ${(e as Error).message}`)
      continue
    }
    console.log(`\n${hotKey}: ${rooms.length} 个开播房间 ${rooms.slice(0, 3).join(", ")}${rooms.length > 3 ? "…" : ""}`)

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
      console.log(`  ${roomKey} ${rid}: ${count} 条${sample.length ? " | " + sample.join(" · ") : ""}`)
    }
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("❌ failed:", e)
  process.exit(1)
})
