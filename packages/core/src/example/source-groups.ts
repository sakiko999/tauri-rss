/**
 * source-groups example —— 验证两点(所有 source 只从 crawler 获取):
 *   1. source 实例:相同 channel + 相同 defaultInfo → 同一实例(缓存);不同 channel → 不同实例。
 *   2. source 一对多分组:同一 channel(相同 source)的订阅可挂到多个 group。
 *
 * Run: bun run packages/core/src/example/source-groups.ts
 */
import { listChannels, type RssChannel } from "@tauri-playground/crawler"
import { setupBackends } from "./backend.ts"

function isSame(a: { fetch(): Promise<string> }, b: { fetch(): Promise<string> }): boolean {
  return a === b
}

async function main() {
  const dl = setupBackends()

  // 从 crawler 挑选有 defaultInfo 的代表 channel(不手写任何参数)
  const all = listChannels().filter((c) => c.defaultInfo)
  const pick = (key: string): RssChannel => {
    const ch = all.find((c) => c.key === key)
    if (!ch) throw new Error(`channel ${key} 无 defaultInfo`)
    return ch
  }
  const hn = pick("rss:hn")
  const ruan = pick("rss:ruanyifeng")
  const rank = pick("bili:rank")

  // ── 1. source 实例验证(参数全部来自 channel.defaultInfo)─────────────────
  console.log("═══ 1. source 实例(相同 channel 同参数 → 同一实例;不同 channel → 不同实例)═══")

  const hnA = hn.getSource(hn.defaultInfo!)
  const hnB = hn.getSource(hn.defaultInfo!)
  const ruanSrc = ruan.getSource(ruan.defaultInfo!)
  const rankA = rank.getSource(rank.defaultInfo!)
  const rankB = rank.getSource(rank.defaultInfo!)
  console.log(`  rss:hn    defaultInfo 两次     → 同一实例: ${isSame(hnA, hnB)}`)
  console.log(`  bili:rank defaultInfo 两次     → 同一实例: ${isSame(rankA, rankB)}`)
  console.log(`  rss:hn vs rss:ruanyifeng      → 不同实例: ${!isSame(hnA, ruanSrc)}`)

  // ── 2. source 一对多分组 ───────────────────────────────────────────────
  console.log("\n═══ 2. source 一对多分组(同一 channel 的订阅挂到多个 group)═══")

  const t = Date.now()
  await dl.subscriptions.addGroup({ id: "g-tech", title: "科技" })
  await dl.subscriptions.addGroup({ id: "g-news", title: "新闻" })

  // 同一 rss:hn source(相同 defaultInfo)建 2 个订阅,分挂不同 group
  await dl.subscriptions.add({
    id: "hn-tech",
    channelKey: hn.key,
    title: "HN · 科技组",
    groupId: "g-tech",
    enabled: true,
    info: hn.defaultInfo!,
    createdAt: t,
    updatedAt: t,
  })
  await dl.subscriptions.add({
    id: "hn-news",
    channelKey: hn.key,
    title: "HN · 新闻组",
    groupId: "g-news",
    enabled: true,
    info: hn.defaultInfo!,
    createdAt: t,
    updatedAt: t,
  })
  // 另一 source(rss:ruanyifeng)也挂 g-tech
  await dl.subscriptions.add({
    id: "ruan-tech",
    channelKey: ruan.key,
    title: "阮一峰 · 科技组",
    groupId: "g-tech",
    enabled: true,
    info: ruan.defaultInfo!,
    createdAt: t,
    updatedAt: t,
  })

  console.log("  ├─ groups:")
  for (const g of await dl.subscriptions.listGroups()) {
    const members = (await dl.subscriptions.list()).filter((s) => s.groupId === g.id)
    console.log(`  │  ${g.id} (${g.title}): ${members.map((m) => m.id).join(", ")}`)
  }
  console.log("  ├─ 同一 rss:hn source 挂 2 组 → 一对多成立")
  console.log("  └─ 订阅明细:")
  for (const s of await dl.subscriptions.list()) {
    console.log(`     ${s.id.padEnd(12)} ${s.channelKey.padEnd(16)} group=${s.groupId ?? "-"}`)
  }

  // refresh 演示:两个 hn 订阅共享同一底层 source(缓存),只拉一次网络
  console.log("\n═══ refresh 两个 hn 订阅(共享同一底层 source)═══")
  const results = await Promise.all([dl.refresh("hn-tech"), dl.refresh("hn-news")])
  for (const r of results) {
    console.log(`  ${r.subscriptionId.padEnd(10)} itemCount=${r.itemCount} error=${r.error ?? "-"}`)
  }
}

main().catch((err) => {
  console.error("❌ example failed:", err)
  process.exit(1)
})
