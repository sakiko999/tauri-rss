/**
 * list_channels —— 只列 channel,不 fetch。
 * 打印每个已注册 channel 的 key / name / kind / sourceInfoTpl(表单参数)。
 *
 * Run: bun run packages/crawler/src/example/list_channels.ts
 */
import { listChannels } from "../index.ts"

function main() {
  const channels = listChannels()
  console.log(`共 ${channels.length} 个 channel`)
  for (const ch of channels) {
    const tpl = (ch.sourceInfoTpl ?? [])
      .map((f) => `${f.key}${f.required ? "*" : ""}`)
      .join(", ")
    console.log(`  ${ch.key.padEnd(24)} ${ch.name.padEnd(18)} ${ch.kind.padEnd(7)}${tpl ? `  [${tpl}]` : ""}`)
  }
}

main()
