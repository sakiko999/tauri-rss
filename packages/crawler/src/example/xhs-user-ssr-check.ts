/**
 * 验证:登录态下导航小红书 user profile 页,SSR `window.__INITIAL_STATE__.user.notes`
 * 是否非空——RSSHub 新版 `getUserWithCookie` 正是此路径(带 cookie 请求 profile 页
 * HTML → 解析 SSR `user.notes`,flat 后每项 `{ noteCard, id }`),而**不是** fetch
 * `user_posted` API。对比我们当前「导航 + 页面内 fetch user_posted」的风控差异。
 *
 * 判据:
 *   - `#userPostedFeeds` 选择器:小红书**只有登录态**才渲染此区块(匿名显示登录引导)
 *   - `state.user.notes` 分组数组:登录态下每组含 noteCard(匿名时是空分组 [[],[],…])
 *   - `.fe-verify-box`:风控验证框出现 = 当前环境被拦
 *
 * 用法(需先关 tauri,否则 edge-profile 被生产 Edge 占用):
 *   ./node_modules/.bin/tsx packages/crawler/src/example/xhs-user-ssr-check.ts [user_id]
 */
import { chromium } from "playwright-core"

const USER_ID = process.argv[2] ?? "593032945e87e77791e03696"
const PROFILE = "C:\\Users\\zhong\\AppData\\Roaming\\com.zhh.tauri-app\\edge-profile"

async function main() {
  const ctx = await chromium.launchPersistentContext(PROFILE, { channel: "msedge", headless: false })
  const page = ctx.pages()[0] ?? (await ctx.newPage())

  // 登录态检查(web_session 是 HttpOnly,用 CDP 层读)。
  const cookies = await ctx.cookies("https://www.xiaohongshu.com")
  const has = cookies.some((c) => c.name === "web_session")
  console.log("[xhs-ssr-check] web_session:", has ? "有" : "无")

  // 导航 profile 页 = 正常浏览行为(非 XHR API)。
  const url = `https://www.xiaohongshu.com/user/profile/${USER_ID}`
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 })
  await page.waitForTimeout(2000) // 等 SSR 挂载 + 登录态区块渲染

  // 风控验证框检测(RSSHub getUser 同款)。
  const verifyBox = await page.$(".fe-verify-box")
  console.log("[xhs-ssr-check] 风控验证框 .fe-verify-box:", verifyBox ? "出现!!!(被拦)" : "无")

  // 提取 SSR user.notes 结构摘要(页面内直接取对象,浏览器已解析过 new Map 等表达式)。
  const summary = await page.evaluate(() => {
    const s = (window as any).__INITIAL_STATE__
    if (!s) return { hasState: false }
    const user = s.user
    const notes = user?.notes
    const rawNotes = notes?._rawValue ?? notes
    const flat = Array.isArray(rawNotes) ? rawNotes.flat() : []
    const first = flat[0] as any
    // #userPostedFeeds 里的封面链接样本(正常浏览渲染的笔记入口)。
    const domLinks = Array.from(document.querySelectorAll("#userPostedFeeds a.cover")).slice(0, 3).map((a) => ({
      href: (a as HTMLAnchorElement).href.slice(0, 100),
    }))
    return {
      hasState: true,
      userPostedFeedsRendered: !!document.querySelector("#userPostedFeeds"),
      postedFeedsLinks: document.querySelectorAll("#userPostedFeeds a.cover").length,
      userKeys: Object.keys(user ?? {}),
      notesType: typeof rawNotes,
      notesKeys: rawNotes && typeof rawNotes === "object" ? Object.keys(rawNotes).slice(0, 8) : [],
      notesIsArray: Array.isArray(rawNotes),
      groups: Array.isArray(rawNotes) ? rawNotes.length : -1,
      flatCount: flat.length,
      firstItem: first
        ? {
            keys: Object.keys(first),
            id: first.id,
            noteCardKeys: Object.keys(first.noteCard ?? {}),
            displayTitle: first.noteCard?.displayTitle,
            noteIdInCard: first.noteCard?.noteId,
            coverUrl: first.noteCard?.cover?.urlDefault?.slice(0, 60),
          }
        : null,
      domLinks,
      nickname: user?.userPageData?.basicInfo?.nickname,
    }
  })
  console.log("[xhs-ssr-check] SSR 摘要:", JSON.stringify(summary, null, 2))

  await ctx.close()
  process.exit(0)
}

main().catch((e) => {
  console.error("[xhs-ssr-check] 失败:", e)
  process.exit(1)
})
