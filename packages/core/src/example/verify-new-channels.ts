/**
 * 端到端验证 4 个新 channel + resolveHotWord(走完整 DataLayer,含 core cookie 注入)。
 *
 * Run: bun run packages/core/src/example/verify-new-channels.ts
 */
import { injectNodeHost } from "@tauri-playground/host"
import { createDataLayer } from "../index.ts"

async function main() {
  injectNodeHost()
  const dl = createDataLayer()
  const t = Date.now()
  const tests: { channelKey: string; title: string; info: Record<string, string> }[] = [
    { channelKey: "weibo:user", title: "微博·何炅", info: { uid: "1195230310" } },
    { channelKey: "weibo:hot", title: "微博热搜", info: {} },
    { channelKey: "xhs:user", title: "小红书·小宇菇菇", info: { user_id: "593032945e87e77791e03696" } },
    { channelKey: "xhs:explore", title: "小红书发现页", info: {} },
  ]

  for (const [i, tst] of tests.entries()) {
    const id = `s-verify-${i}`
    await dl.subscriptions.add({ id, channelKey: tst.channelKey, title: tst.title, enabled: true, info: tst.info, createdAt: t, updatedAt: t })
    const r = await dl.refresh(id)
    const items = dl.store.query({ subscriptionId: id })
    console.log(`${tst.channelKey}: error=${r.error ?? "无"} items=${items.length}`)
    const first = items[0] as any
    if (first) {
      const imgCount = first.kind === "social" ? first.images?.length ?? 0 : "-"
      const likes = first.kind === "social" ? first.likes ?? "-" : "-"
      console.log(`  首条: [${first.kind}] ${String(first.title).slice(0, 40)} | 图:${imgCount} | 赞:${likes}`)
      if (first.kind === "social" && first.images?.length) {
        const img = first.images[0]
        console.log(`  首图: ${img.width}x${img.height} ${img.url.slice(0, 60)}`)
      }
    }
  }

  // resolveHotWord:找 weibo:hot 订阅,拉一个热搜词下流。
  const subs = await dl.subscriptions.list()
  const hotSub = subs.find((s) => s.channelKey === "weibo:hot")
  if (hotSub) {
    const word = "歌手2026"
    try {
      const items = await dl.resolveHotWord(hotSub.id, word)
      console.log(`\nresolveHotWord("${word}") → items:`, items.length)
      const first = items[0] as any
      if (first) console.log(`  首条: [${first.kind}] ${String(first.title).slice(0, 50)}`)
    } catch (e) {
      console.log("resolveHotWord 失败:", (e as Error).message)
    }
  }
}

main()
