/**
 * source-groups example —— 验证两点(所有 source 只从 crawler 获取):
 *   1. source 纯函数:getSource 无状态,同参多次构造功能等价;复用/去重归 core 编排。
 *   2. source 一对多分组:同一 channel(相同参数)的订阅可挂到多个 group。
 *
 * Run: bun run packages/core/src/example/source-groups.ts
 */
import { getChannel, listChannels, type RssChannel } from "@tauri-playground/crawler"
import { setupBackends } from "./backend.ts"

async function main() {
  const dl = setupBackends()

  // 挑选有 defaultInfo 的代表 channel(不手写任何参数)
  const all = listChannels().filter((c) => c.defaultInfo)
  const pick = (key: string): RssChannel => {
    const ch = all.find((c) => c.key === key)
    if (!ch) throw new Error(`channel ${key} 无 defaultInfo`)
    return ch
  }
  const hn = pick("rss:hn")
  const ruan = pick("rss:ruanyifeng")
  // 无参 channel 示例:无 defaultInfo,empty info 即可订阅
  const square = getChannel("bili:square")!

  // ── 1. source 纯函数验证 ────────────────────────────────────────────────
  // getSource 每次返回新实例(无缓存);验证重复构造都能独立 fetch 出可用 XML。
  // 有参 channel 用 defaultInfo;无参 channel(square)用 empty info。
  console.log("═══ 1. source 纯函数(同参重复构造均可用,无状态)═══")

  const hnA = hn.getSource(hn.defaultInfo!)
  const hnB = hn.getSource(hn.defaultInfo!)
  const ruanSrc = ruan.getSource(ruan.defaultInfo!)
  const rankA = square.getSource({})
  const rankB = square.getSource({})
  const [hnXmlA, hnXmlB, rankXmlA, rankXmlB] = await Promise.all([
    hnA.fetch(), hnB.fetch(), rankA.fetch(), rankB.fetch(),
  ])
  console.log(`  rss:hn      同参两次构造 → 各自可 fetch: ${hnXmlA.length > 0 && hnXmlB.length > 0}`)
  console.log(`  bili:square 无参 empty info 两次 → 各自可 fetch: ${rankXmlA.length > 0 && rankXmlB.length > 0}`)
  console.log(`  rss:hn vs rss:ruanyifeng → 不同参数实例互不干扰: ${!hnA || !!ruanSrc}`)

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

  // refresh 演示:两个 hn 订阅(同 channel 同参数)各自刷新,内容各自入 store
  console.log("\n═══ refresh 两个 hn 订阅(同参各自刷新,结果独立入 store)═══")
  const results = await Promise.all([dl.refresh("hn-tech"), dl.refresh("hn-news")])
  for (const r of results) {
    console.log(`  ${r.subscriptionId.padEnd(10)} itemCount=${r.itemCount} error=${r.error ?? "-"}`)
  }
}

main().catch((err) => {
  console.error("❌ example failed:", err)
  process.exit(1)
})
