/**
 * sample_sources —— 抽样打印 source 输出的数据。
 * 逐 channel fetch XML,打印前 N 字符(可带过滤参数:key 子串)。
 *
 * Run: bun run packages/crawler/src/example/sample_sources.ts [filter]
 *   filter  可选:只打印 key 含该子串的 channel(如 "live:" 只看直播)
 */
import { listChannels } from "../index.ts"
import { setupBackends, exampleInfo } from "./backend.ts"

const PREVIEW = 300

async function main() {
  setupBackends()
  const filter = process.argv[2]?.toLowerCase() ?? ""
  const channels = listChannels().filter((ch) => !filter || ch.key.toLowerCase().includes(filter))
  console.log(`抽样 ${channels.length}/${listChannels().length} 个 channel(filter="${filter}")`)

  for (const ch of channels) {
    console.log(`\n═══ ${ch.key} (${ch.name}) ═══`)
    const source = ch.getSource(exampleInfo(ch.key))
    try {
      const xml = await source.fetch()
      const head = xml.slice(0, PREVIEW)
      console.log(head + (xml.length > PREVIEW ? `\n  … (${xml.length} 字符,截断)` : ""))
    } catch (err) {
      console.log(`  ❌ ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

main().catch((err) => {
  console.error("❌ example failed:", err)
  process.exit(1)
})
