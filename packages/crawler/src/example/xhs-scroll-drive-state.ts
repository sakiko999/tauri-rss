/**
 * 验证「滚动驱动分页」:xhs profile 页滚动后 platform 自己加载更多(user_posted 完整签名),
 * `__INITIAL_STATE__.user.notes` reactive state 是否追加新笔记——若更新,则 fetchMore
 * 可 = 模拟滚动 + 读 state 增量(绕开 x-s-common/x-rap-param 手拼签名,完全正常浏览语义)。
 *
 * 用法(需先关 tauri,否则 edge-profile 被生产 Edge 占用):
 *   ./node_modules/.bin/tsx packages/crawler/src/example/xhs-scroll-drive-state.ts [user_id]
 */
import { chromium } from "playwright-core"

const USER_ID = process.argv[2] ?? "593032945e87e77791e03696"
const PROFILE = "C:\\Users\\zhong\\AppData\\Roaming\\com.zhh.tauri-app\\edge-profile"

/** 页面内取 notes flat(解 _rawValue)。 */
const NOTES_EXPR = `(() => {
  const u = window.__INITIAL_STATE__?.user;
  const raw = u?.notes?._rawValue ?? u?.notes;
  return Array.isArray(raw) ? { count: raw.flat().length, last: raw.flat()[raw.flat().length - 1]?.id, first: raw.flat()[0]?.noteCard?.displayTitle } : { count: -1 };
})()`

async function main() {
  const ctx = await chromium.launchPersistentContext(PROFILE, { channel: "msedge", headless: false })
  const page = ctx.pages()[0] ?? (await ctx.newPage())

  await page.goto(`https://www.xiaohongshu.com/user/profile/${USER_ID}`, { waitUntil: "domcontentloaded", timeout: 30_000 })
  await page.waitForTimeout(3000)
  const before = await page.evaluate<{ count: number; last: string | null; first: string | null }>(`(${NOTES_EXPR})`)
  console.log("[xhs-scroll-state] 滚动前 notes:", JSON.stringify(before))

  // 模拟真实滚动触底(平台自己触发加载更多)。
  for (let i = 0; i < 40; i++) {
    await page.mouse.move(600, 500)
    await page.mouse.wheel(0, 900)
    await page.waitForTimeout(600)
  }
  await page.waitForTimeout(3000)

  const after = await page.evaluate<{ count: number; last: string | null; first: string | null }>(`(${NOTES_EXPR})`)
  console.log("[xhs-scroll-state] 滚动后 notes:", JSON.stringify(after))
  console.log("[xhs-scroll-state] 增量:", (after.count ?? -1) - (before.count ?? -1))

  await ctx.close()
  process.exit(0)
}

main().catch((e) => {
  console.error("[xhs-scroll-state] 失败:", e)
  process.exit(1)
})