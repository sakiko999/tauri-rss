/**
 * data-layer example —— core 极简验收:从 crawler 输出的 channel 直接订阅。
 *
 * 初始化(注入 appHost + 构造 DataLayer + 批量订阅)在 backend.ts,这里只跑
 * 示例逻辑:列出订阅 → 并行 refresh → store 总览 → update/remove。
 *
 * Run: bun run packages/core/src/example/data-layer.ts
 */
import { listChannels } from "@tauri-playground/crawler"
import { setupBackends, subscriptionsFromChannels } from "./backend.ts"

async function main() {
  // 1. 初始化:注入 appHost + 构造 DataLayer
  const dl = setupBackends()

  // 2. 从 crawler 输出的 channel 批量订阅(有 defaultInfo 直接用,无的手动补)
  await subscriptionsFromChannels(dl)
  const all = listChannels()
  console.log(`═══ 订阅了 ${all.length}/${all.length} 个 channel ═══`)
  for (const s of await dl.subscriptions.list()) {
    console.log(`  ${s.channelKey.padEnd(22)} ${s.title}`)
  }

  // 3. 并行 refresh 全部,打印每个的结果
  console.log("\n═══ 并行 refresh 全部订阅 ═══")
  const results = await Promise.all(
    (await dl.subscriptions.list()).map((s) => dl.refresh(s.id)),
  )
  const ok = results.filter((r) => !r.error)
  const fail = results.filter((r) => r.error)
  for (const r of ok) {
    console.log(`  ✓ ${r.subscriptionId.padEnd(22)} ${r.itemCount} items`)
  }
  for (const r of fail) {
    console.log(`  ✗ ${r.subscriptionId.padEnd(22)} ${r.error}`)
  }
  console.log(`\n  成功 ${ok.length}/${results.length},失败 ${fail.length}`)

  // 4. store 总览
  console.log(`\n═══ store 总览(共 ${dl.store.all().length} 条)前 8 条 ═══`)
  for (const it of dl.store.all().slice(0, 8)) {
    console.log(`  [${it.kind}] ${it.title.slice(0, 44)}  unread=${it.isUnread}`)
  }

  // 5. update + remove(单条演示)
  const first = (await dl.subscriptions.list())[0]
  if (first) {
    const updated = await dl.subscriptions.update(first.id, { title: `${first.title} · 改` })
    console.log(`\n═══ update ${first.id} ═══`)
    console.log(`  title=${updated?.title} updatedAt=${updated?.updatedAt}`)
    await dl.subscriptions.remove(first.id)
    console.log(`═══ remove ${first.id} ═══`)
    console.log(`  剩余订阅:${(await dl.subscriptions.list()).length}, store 剩余:${dl.store.all().length}`)
  }
}

main().catch((err) => {
  console.error("❌ example failed:", err)
  process.exit(1)
})
