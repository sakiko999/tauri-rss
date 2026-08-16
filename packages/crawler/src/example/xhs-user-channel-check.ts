/**
 * 验证:修复后 xhs:user 浏览器路径(导航 profile 页 → SSR user.notes → noteCardToSocial)
 * 在登录态 Edge profile 下端到端产出。对比旧「页面内 fetch user_posted」的 300011 风控。
 *
 * 用法(需先关 tauri,否则 edge-profile 被生产 Edge 占用):
 *   ./node_modules/.bin/tsx packages/crawler/src/example/xhs-user-channel-check.ts [user_id]
 */
import { chromium } from "playwright-core"
import { XhsUserChannel } from "../channels/xhs/user.ts"
import { makePlaywrightBackend } from "./backend.ts"

const USER_ID = process.argv[2] ?? "593032945e87e77791e03696"
const PROFILE = "C:\\Users\\zhong\\AppData\\Roaming\\com.zhh.tauri-app\\edge-profile"

async function main() {
  const ctx = await chromium.launchPersistentContext(PROFILE, { channel: "msedge", headless: false })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  // 注入浏览器门面(xhs:user 的 fetchViaBrowser 检测 globalThis.appHost.browser)。
  ;(globalThis as any).appHost = { browser: makePlaywrightBackend(page, () => ctx.close()), now: () => Date.now() }

  const ch = new XhsUserChannel()
  const source = ch.getSource({ user_id: USER_ID })
  const xml = await source.fetch()
  const itemCount = (xml.match(/<item>/g) ?? []).length
  // 打印前 2 条标题(非 XML 转义直接截)。
  const titles = [...xml.matchAll(/<title>(.*?)<\/title>/g)].slice(0, 2).map((m) => m[1])
  console.log("[xhs-user-channel] 首页 item 数:", itemCount)
  console.log("[xhs-user-channel] 前 2 条标题:", JSON.stringify(titles))
  // xhs 图片宽高(SSR cover 是否自带)——确认瀑布流 cell 高度估算依赖是否成立。
  const imgMeta = [...xml.matchAll(/<tpl:image url="([^"]*)" width="([^"]*)" height="([^"]*)"/g)].slice(0, 2).map((m) => ({ w: m[2], h: m[3] }))
  console.log("[xhs-user-channel] 图片宽高样本:", JSON.stringify(imgMeta))

  // 翻页(滚动驱动):连续两次 fetchMore——验证 cursor 递增 + 增量不重复(修复 cdpNavigate
  // 同址重载后,state 应保留,每次拿到真增量而非同一批 120 条)。
  if (source.fetchMore) {
    for (let i = 0; i < 2; i++) {
      console.log(`[xhs-user-channel] fetchMore #${i + 1}…`)
      const more = await source.fetchMore()
      const itemCount = (more.xml.match(/<item>/g) ?? []).length
      const firstTitle = [...more.xml.matchAll(/<title>(.*?)<\/title>/g)][1]?.[1]?.slice(0, 20)
      console.log(`[xhs-user-channel] #${i + 1} item 数:${itemCount} cursor:${more.cursor} 首标题:${firstTitle}`)
    }
  } else {
    console.log("[xhs-user-channel] 无 fetchMore(未注入浏览器?)")
  }

  await ctx.close()
  process.exit(0)
}

main().catch((e) => {
  console.error("[xhs-user-channel] 失败:", e)
  process.exit(1)
})
