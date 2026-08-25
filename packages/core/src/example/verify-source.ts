/**
 * 验证 source 层: 聚合(listChannels/getChannel) + rsshub 直传(refresh)。
 * 要求本地 RSSHub 已在 1200 起服务(RSSHub:weibo:hot 匿名可用)。
 * Run: bun run packages/core/src/example/verify-source.ts
 */
import { setupBackends } from "./backend.ts"
import "../source/rsshub.ts"

async function main() {
  const dl = setupBackends()

  // 1. 聚合验证(listChannels 分流)
  const all = dl.listChannels()
  const rsshub = all.filter((c) => c.key.startsWith("rsshub:"))
  const crawler = all.length - rsshub.length
  console.log(`═══ source 聚合: 总计 ${all.length} (crawler ${crawler} + rsshub ${rsshub.length}) ═══`)
  for (const c of rsshub) {
    const tpl = c.sourceInfoTpl?.map((f) => `${f.key}${f.required ? "*" : ""}`).join(", ") ?? "无参"
    console.log(`  ${c.key.padEnd(24)} ${c.name.padEnd(22)} [${c.kind}]  tpl: ${tpl}`)
  }
  if (rsshub.length === 0) throw new Error("rsshub 渠道未注册——聚合层失败")

  // 2. rsshub 直传 refresh(weibo:hot 单条订阅,isolated)
  const id = await dl.addSubscription("rsshub:weibo:hot", "RSSHub 微博热搜(验证)", {})
  console.log(`\n═══ refresh rsshub:weibo:hot (${id}) ═══`)
  const r = await dl.refresh(id)
  if (r.error) throw new Error(`refresh 失败: ${r.error}`)
  console.log(`  ✓ ${r.itemCount} items`)

  // 3. store 验证(kind/首条)
  const items = dl.store.query({ subscriptionId: id })
  console.log(`\n  store.query(${id}): ${items.length} 条,首条 kind=${items[0]?.kind} title="${items[0]?.title.slice(0, 40)}"`)
  if (items.length === 0) throw new Error("store 为空——rsshub 直传链未通")

  console.log("\n✅ verify-source 通")
}

main().catch((e) => {
  console.error("❌", e)
  process.exit(1)
})
