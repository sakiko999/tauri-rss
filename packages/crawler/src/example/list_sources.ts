/**
 * list_sources —— 每个 channel 实例化 source,不 fetch。
 * 用 exampleInfo 给参数,打印 source 的形态(key + 传入的 info + sourceInfoTpl)。
 * 验证「一个 key → getSource(info)」的实例化链路。
 *
 * Run: bun run packages/crawler/src/example/list_sources.ts
 */
import { listChannels } from "../index.ts"
import { setupBackends, exampleInfo } from "./backend.ts"

function main() {
  setupBackends() // source 实例化不请求网络,但直播 channel 构造不需要;保持一致注入
  const channels = listChannels()
  console.log(`共 ${channels.length} 个 channel,逐一实例化 source(不 fetch)`)
  for (const ch of channels) {
    const info = exampleInfo(ch.key)
    const source = ch.getSource(info)
    const argSummary = Object.keys(info).length
      ? Object.entries(info).map(([k, v]) => `${k}=${v}`).join(" ")
      : "(无参数)"
    const srcType = source.constructor?.name ?? typeof source
    console.log(`  ${ch.key.padEnd(24)} → ${srcType}  [${argSummary}]`)
  }
}

main()
