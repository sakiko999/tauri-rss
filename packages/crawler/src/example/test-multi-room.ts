/**
 * test-multi-room —— live 多房间订阅 + hot channel 委托能力验证。
 *
 * 验证点(能力抽离后):
 *   1. live channel 传 roomIds(逗号分隔) → fetch 返回多个 Live item(一个订阅=多个直播间);
 *   2. 兼容旧 roomId 单房间;
 *   3. roomId 从 item.url 提取(live.bilibili.com/{rid} 等),不再依赖 tpl:roomId;
 *   4. hot 的流解析走 crawler/resolver(按 item.url),实际能解析出流。
 *
 * Run: bun run packages/crawler/src/example/test-multi-room.ts
 */
import { getChannel, resolveLivePlayByUrl, type ResolvePlatform, type SourceInfo } from "../index.ts"
import { parseFeed } from "../../../xml/src/xml-parser.ts"
import { setupBackends } from "./backend.ts"
import { DEFAULT_BILIBILI_COOKIE } from "../../../core/src/bilibili-cookie.ts"

/** 从 live item.url 提取 roomId。 */
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
  const t0 = Date.now()

  // 1. bili:live 多房间订阅(roomIds 逗号分隔)。
  const bili = getChannel("bili:live")!
  const biliInfo: SourceInfo = { roomIds: "7734200,21144080,999999999" } // 含一个不存在房间测失败隔离
  const xml = await bili.getSource(biliInfo).fetch()
  const items = parseFeed(xml).channel.item
  console.log(`[1] bili:live roomIds=多房间 → ${items.length} 个 item(期望 2,失败房间被跳过):`)
  for (const it of items) console.log(`    roomId=${roomIdFromUrl(it.link ?? "", "bilibili")} title=${it.title}`)

  // 2. 兼容旧 roomId 单房间。
  const xml2 = await bili.getSource({ roomId: "7734200" } as SourceInfo).fetch()
  const n2 = parseFeed(xml2).channel.item.length
  console.log(`[2] bili:live roomId=单房间 → ${n2} 个 item(期望 1)`)

  // 3. hot channel 输出 roomId(从 item.url 提取,委托能力已并入 resolver)。
  for (const [key, platform] of [["bili:live:hot", "bilibili"], ["live:douyu:hot", "douyu"], ["live:huya:hot", "huya"], ["live:douyin:hot", "douyin"]] as Array<[string, ResolvePlatform]>) {
    const ch = getChannel(key)
    if (!ch) {
      console.log(`[3] ${key}: 未知 channel`)
      continue
    }
    const info: SourceInfo = key === "bili:live:hot" ? { cookie: DEFAULT_BILIBILI_COOKIE } : {}
    const hotXml = await ch.getSource(info).fetch()
    const rooms = parseFeed(hotXml).channel.item.map((i) => roomIdFromUrl(i.link ?? "", platform)).filter(Boolean)
    console.log(`[3] ${key}: ${rooms.length} 个开播房间(从 item.url 提取)`)
  }

  // 4. hot 流解析走 crawler/resolver(bili/douyu 热门前 1 房间,验证流解析成功)。
  for (const [hotKey, cookie] of [
    ["bili:live:hot", DEFAULT_BILIBILI_COOKIE],
    ["live:douyu:hot", ""],
  ] as Array<[string, string]>) {
    const hot = getChannel(hotKey)!
    const hotXml = await hot.getSource(cookie ? { cookie } : {}).fetch()
    const firstUrl = parseFeed(hotXml).channel.item[0]?.link
    if (!firstUrl) {
      console.log(`[4] ${hotKey}: 无开播房间`)
      continue
    }
    try {
      const { id, streams } = await resolveLivePlayByUrl(firstUrl, cookie ? { cookie } : undefined)
      console.log(`[4] ${hotKey} 房间 ${id}: resolveLivePlayByUrl → ${streams.length} 档 [${streams.map((s) => s.quality ?? s.format).join(", ")}]`)
    } catch (e) {
      console.log(`[4] ${hotKey} 房间: resolveLivePlayByUrl 失败: ${(e as Error).message}`)
    }
  }

  console.log(`\n耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("❌ failed:", e)
  process.exit(1)
})