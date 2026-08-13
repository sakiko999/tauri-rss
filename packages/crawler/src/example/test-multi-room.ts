/**
 * test-multi-room —— live 多房间订阅 + hot channel 委托能力验证。
 *
 * 验证点:
 *   1. live channel 传 roomIds(逗号分隔) → fetch 返回多个 Live item(一个订阅=多个直播间);
 *   2. 兼容旧 roomId 单房间;
 *   3. hot channel 的 source 具备 resolveLivePlay/getDanmaku(委托同平台 live),
 *      点热门卡片可播放+弹幕(不再「列表能看、点开没流」);
 *   4. hot 委托的 resolveLivePlay 实际能解析出流(bili 热门前 2 房间 + douyu 热门前 2)。
 *
 * Run: bun run packages/crawler/src/example/test-multi-room.ts
 */
import { getChannel, isDanmakuPlayable, isRssLiveSource, type SourceInfo } from "../index.ts"
import { parseFeed } from "../../../xml/src/xml-parser.ts"
import { setupBackends } from "./backend.ts"
import { DEFAULT_BILIBILI_COOKIE } from "../../../core/src/bilibili-cookie.ts"

async function main() {
  setupBackends()
  const t0 = Date.now()

  // 1. bili:live 多房间订阅(roomIds 逗号分隔)。
  const bili = getChannel("bili:live")!
  const biliInfo: SourceInfo = { roomIds: "7734200,21144080,999999999" } // 含一个不存在房间测失败隔离
  const xml = await bili.getSource(biliInfo).fetch()
  const items = parseFeed(xml).channel.item
  console.log(`[1] bili:live roomIds=多房间 → ${items.length} 个 item(期望 2,失败房间被跳过):`)
  for (const it of items) console.log(`    roomId=${String((it.raw as any)?.["tpl:roomId"])} title=${it.title}`)

  // 2. 兼容旧 roomId 单房间。
  const xml2 = await bili.getSource({ roomId: "7734200" } as SourceInfo).fetch()
  const n2 = parseFeed(xml2).channel.item.length
  console.log(`[2] bili:live roomId=单房间 → ${n2} 个 item(期望 1)`)

  // 3. hot channel source 能力探测(委托同平台 live)。
  for (const key of ["bili:live:hot", "live:douyu:hot", "live:huya:hot", "live:douyin:hot"]) {
    const ch = getChannel(key)
    if (!ch) {
      console.log(`[3] ${key}: 未知 channel`)
      continue
    }
    const info: SourceInfo = key === "bili:live:hot" ? { cookie: DEFAULT_BILIBILI_COOKIE } : {}
    const s = ch.getSource(info)
    console.log(`[3] ${key}: livePlayable=${isRssLiveSource(s)} danmakuPlayable=${isDanmakuPlayable(s)}`)
  }

  // 4. hot 委托 resolveLivePlay 实际解析(bili/douyu 热门前 2 房间,只验证第一个解析成功)。
  for (const [hotKey, cookie] of [
    ["bili:live:hot", DEFAULT_BILIBILI_COOKIE],
    ["live:douyu:hot", ""],
  ] as Array<[string, string]>) {
    const hot = getChannel(hotKey)!
    const hotSource = hot.getSource(cookie ? { cookie } : {})
    const hotXml = await hotSource.fetch()
    const hotRooms = parseFeed(hotXml).channel.item
      .map((i) => String((i.raw as Record<string, unknown> | undefined)?.["tpl:roomId"] ?? ""))
      .filter(Boolean)
    const roomId = hotRooms[0]
    if (!roomId) {
      console.log(`[4] ${hotKey}: 无开播房间`)
      continue
    }
    if (!isRssLiveSource(hotSource)) {
      console.log(`[4] ${hotKey}: 无 resolveLivePlay`)
      continue
    }
    try {
      const streams = await hotSource.resolveLivePlay(roomId)
      console.log(`[4] ${hotKey} 房间 ${roomId}: resolveLivePlay → ${streams.length} 档 [${streams.map((s) => s.quality ?? s.format).join(", ")}]`)
    } catch (e) {
      console.log(`[4] ${hotKey} 房间 ${roomId}: resolveLivePlay 失败: ${(e as Error).message}`)
    }
  }

  console.log(`\n耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("❌ failed:", e)
  process.exit(1)
})
