/**
 * test-danmaku —— 实测四平台弹幕流(订阅收弹幕)。
 *
 * 对 bili live / douyu / huya / douyin 调 `getDanmaku(roomId)` 订阅 N 秒收弹幕。
 * 需对应房间正在直播(离线房间无弹幕,判定「0 条」不代表失败)。
 * bili 带 core 默认登录 cookie(getDanmuInfo 更稳);douyin 原生 WS 缺 cookie,可能收不到。
 *
 * Run: bun run packages/crawler/src/example/test-danmaku.ts [seconds]
 */
import { getChannel, isDanmakuPlayable, type DanmakuItem } from "../index.ts"
import { setupBackends } from "./backend.ts"
import type { SourceInfo } from "../index.ts"
import { DEFAULT_BILIBILI_COOKIE } from "../../../core/src/bilibili-cookie.ts"

const TESTS: Array<[string, string]> = [
  ["bili:live", "6"],
  ["live:douyu", "9999"],
  ["live:huya", "60066"],
  ["live:douyin", "217952067344"],
]

async function main() {
  setupBackends()
  const seconds = Number(process.argv[2] ?? 8)
  console.log(`probe: 四平台弹幕(订阅 ${seconds}s)\n`)
  for (const [key, roomId] of TESTS) {
    const ch = getChannel(key)
    if (!ch) {
      console.log(`❌ ${key}: 未知 channel`)
      continue
    }
    const info: SourceInfo = key === "bili:live" ? { cookie: DEFAULT_BILIBILI_COOKIE } : {}
    const source = ch.getSource(info)
    if (!isDanmakuPlayable(source)) {
      console.log(`⚠️ ${key}: 不支持弹幕`)
      continue
    }
    let count = 0
    const unsub = source.getDanmaku(roomId)((batch) => {
      count += batch.length
      const sample = batch
        .slice(0, 3)
        .map((d: DanmakuItem) => `${d.user ? `${d.user}: ` : ""}${d.text}${d.color ? ` [${d.color}]` : ""}`)
        .join(" | ")
      console.log(`  [${key}] +${batch.length}: ${sample}`)
    })
    await new Promise((r) => setTimeout(r, seconds * 1000))
    unsub()
    console.log(`${key}(${roomId}): ${count} 条弹幕\n`)
  }
}

// 强制 exit:WS 连接可能挂住事件循环。
main().then(() => process.exit(0)).catch((err) => {
  console.error("❌ probe failed:", err)
  process.exit(1)
})
