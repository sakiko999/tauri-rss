/**
 * 验证 source 层:聚合(listChannels/getChannel)+ rsshub 外挂渠道可选 refresh。
 *
 * 外挂模式(2026-08-26):rsshub 指向用户配置的外部实例(默认公网 rsshub.app),
 * 需登录源的可用性不在本仓库控制——refresh 失败仅 warn 不 throw,只断言聚合。
 * Run: bun run packages/core/src/example/verify-source.ts
 */
import { setupBackends } from "./backend.ts"
import "../source/rsshub.ts"

async function main() {
  const dl = setupBackends()

  // 1. 聚合验证(listChannels 分流)——crawler 主 + rsshub 外挂。
  const all = dl.listChannels()
  const rsshub = all.filter((c) => c.key.startsWith("rsshub:"))
  const crawler = all.length - rsshub.length
  console.log(`═══ source 聚合: 总计 ${all.length} (crawler ${crawler} + rsshub ${rsshub.length}) ═══`)
  for (const c of rsshub) {
    const tpl = c.sourceInfoTpl?.map((f) => `${f.key}${f.required ? "*" : ""}`).join(", ") ?? "无参"
    console.log(`  ${c.key.padEnd(24)} ${c.name.padEnd(22)} [${c.kind}]  tpl: ${tpl}`)
  }
  if (rsshub.length === 0) throw new Error("rsshub 渠道未注册——聚合层失败")

  // 2. rsshub 外挂 refresh(可选):公网实例可用性不可控,失败 warn 不阻断。
  const id = await dl.addSubscription("rsshub:weibo:hot", "RSSHub 微博热搜(验证)", {})
  console.log(`\n═══ refresh rsshub:weibo:hot (${id},外挂实例) ═══`)
  const r = await dl.refresh(id)
  if (r.error) {
    // 外挂实例对 weibo 需登录/被限是预期;本地自部署实例可正常返回。
    console.log(`  ⚠️ rsshub 外挂不可用(公网实例常 403/需登录): ${r.error} —— 仅验证聚合,非阻断`)
  } else {
    console.log(`  ✓ ${r.itemCount} items`)
  }

  console.log("\n✅ verify-source 通")
}

main().catch((e) => {
  console.error("❌", e)
  process.exit(1)
})
