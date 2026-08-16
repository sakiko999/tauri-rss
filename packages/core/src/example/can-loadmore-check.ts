/**
 * 验证 core `canLoadMore` 对 weibo:user 的真实返回值(排查 desktop Footer 不显示)。
 * ```
 * bun run packages/core/src/example/can-loadmore-check.ts
 * ```
 */
import { setupBackends } from "./backend.ts"

async function main() {
  const dl = setupBackends()
  const id = "s-user-weibo-cancheck"
  await dl.subscriptions.add({
    id,
    channelKey: "weibo:user",
    title: "微博分页测试",
    info: { uid: "5756404150" },
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })
  const ok = await dl.canLoadMore(id)
  console.log("[canLoadMore] weibo:user supported:", ok)
  process.exit(0)
}

main().catch((e) => {
  console.error("[canLoadMore] 失败:", e)
  process.exit(1)
})