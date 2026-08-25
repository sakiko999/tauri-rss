/**
 * test-danmaku —— 四平台直播弹幕回归(热门列表保证在播房间)。
 *
 * 能力抽离后:channel 只输出 Live item(roomId 从 item.url 提取),弹幕走
 * crawler/resolver 的 getDanmakuById(platform, roomId, {kind:"live"})。
 *
 * Run: bun run packages/crawler/src/example/test-danmaku.ts [seconds] [perPlatform]
 */
import { getChannel, getDanmakuById, type ResolvePlatform, type SourceInfo } from "../index.ts"
import { parseFeed } from "../../../xml/src/xml-parser.ts"
import { setupBackends } from "./backend.ts"
import { DEFAULT_BILIBILI_COOKIE } from "../../../core/src/bilibili-cookie.ts"

/** [热门 channel key, 平台]。roomId 从 item.url 提取(live.bilibili.com/{rid} 等)。 */
const HOT: Array<[string, ResolvePlatform]> = [
  ["bili:live:hot", "bilibili"],
  ["live:douyu:hot", "douyu"],
  ["live:huya:hot", "huya"],
  ["live:douyin:hot", "douyin"],
]

/** 从 live item.url 提 roomId(按平台 host 形态)。 */
function roomIdFromUrl(url: string, platform: ResolvePlatform): string | null {
  const m =
    platform === "bilibili" ? url.match(/live\.bilibili\.com\/(\d+)/)
    : platform === "douyu" ? url.match(/douyu\.com\/(\d+)/)
    : platform === "huya" ? url.match(/huya\.com\/(\d+)/)
    : url.match(/live\.douyin\.com\/(\S+)/)
  return m?.[1] ?? null
}

async function main() {
  setupBackends()
  const seconds = Number(process.argv[2] ?? 5)
  const perPlatform = Number(process.argv[3] ?? 3)
  for (const [hotKey, platform] of HOT) {
    const hotCh = getChannel(hotKey)
    if (!hotCh) {
      console.log(`❌ ${hotKey}: 未知 channel`)
      continue
    }
    let rooms: Array<{ id: string; url: string }> = []
    try {
      const hotInfo: SourceInfo = hotKey === "bili:live:hot" ? { cookie: DEFAULT_BILIBILI_COOKIE } : {}
      const xml = await hotCh.getSource(hotInfo).fetch()
      rooms = parseFeed(xml).channel.item
        .map((i) => ({ id: roomIdFromUrl(i.link ?? "", platform) ?? "", url: i.link ?? "" }))
        .filter((r) => !!r.id)
    } catch (e) {
      console.log(`⚠️ ${hotKey}: 热门列表失败: ${(e as Error).message}`)
      continue
    }
    console.log(`\n${hotKey}: ${rooms.length} 个开播房间 ${rooms.slice(0, 3).map((r) => r.id).join(", ")}${rooms.length > 3 ? "…" : ""}`)

    for (const { id, url } of rooms.slice(0, perPlatform)) {
      let count = 0
      const sample: string[] = []
      let danmaku
      try {
        danmaku = getDanmakuById(platform, id, { kind: "live", cookie: platform === "bilibili" ? DEFAULT_BILIBILI_COOKIE : undefined })
      } catch (e) {
        console.log(`  ⚠️ ${platform} ${id}: 无弹幕能力 ${(e as Error).message}`)
        continue
      }
      const unsub = danmaku((batch) => {
        count += batch.length
        for (const d of batch) if (sample.length < 3) sample.push(`${d.user ?? ""}: ${d.text}`)
      })
      await new Promise((r) => setTimeout(r, seconds * 1000))
      unsub()
      console.log(`  ${platform} ${id} (${url.slice(0, 40)}…): ${count} 条${sample.length ? " | " + sample.join(" · ") : ""}`)
    }
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("❌ failed:", e)
  process.exit(1)
})