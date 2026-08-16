/**
 * 验证:weibo:user 浏览器路径(导航 m.weibo.cn → 同源 fetch API)端到端产出。
 * 对照 RSSHub weibo handler(同 API + iPhone UA):我们浏览器路径在页面内同源 fetch,
 * UA 是页面真实 UA,与 SPA 正常浏览一致,无 xhs 式「SSR vs 额外 XHR」差异。
 *
 * 用法(需先关 tauri,否则 edge-profile 被生产 Edge 占用):
 *   ./node_modules/.bin/tsx packages/crawler/src/example/weibo-user-channel-check.ts [uid]
 */
import { chromium } from "playwright-core"
import { WeiboUserChannel } from "../channels/weibo/user.ts"
import { makePlaywrightBackend } from "./backend.ts"

const UID = process.argv[2] ?? "1195230310"
const PROFILE = "C:\\Users\\zhong\\AppData\\Roaming\\com.zhh.tauri-app\\edge-profile"

async function main() {
  const ctx = await chromium.launchPersistentContext(PROFILE, { channel: "msedge", headless: false })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  ;(globalThis as any).appHost = {
    browser: makePlaywrightBackend(page, () => ctx.close()),
    now: () => Date.now(),
    // httpx:长文展开(statuses/extend)走 Node fetch 降级(无 profile cookie,失败无害)。
    http: {
      request: async (opts: { url: string; method?: string; headers?: Record<string, string> }) => {
        const res = await fetch(opts.url, { method: opts.method ?? "GET", headers: opts.headers })
        return { status: res.status, body: await res.text() }
      },
    },
  }

  const ch = new WeiboUserChannel()
  const source = ch.getSource({ uid: UID })
  const xml = await source.fetch()
  const itemCount = (xml.match(/<item>/g) ?? []).length
  const titles = [...xml.matchAll(/<title>(.*?)<\/title>/g)].slice(0, 2).map((m) => m[1])
  const total = xml.match(/<tpl:total>([^<]+)<\/tpl:total>/)?.[1]
  const imgUrls = [...xml.matchAll(/<tpl:image url="([^"]+)"/g)].slice(0, 3).map((m) => m[1])
  console.log("[weibo-user-channel] 首页 item 数:", itemCount, "tpl:total:", total)
  console.log("[weibo-user-channel] 前 2 条标题:", JSON.stringify(titles))
  console.log("[weibo-user-channel] 图片 URL 样本:", JSON.stringify(imgUrls, null, 2))

  // 翻页:fetchMore 应返回新 XML + cursor(最后一条 mblog mid)。
  if (source.fetchMore) {
    const more = await source.fetchMore()
    const moreCount = (more.xml.match(/<item>/g) ?? []).length
    console.log("[weibo-user-channel] fetchMore item 数:", moreCount, "cursor:", more.cursor)
  }

  await ctx.close()
  process.exit(0)
}

main().catch((e) => {
  console.error("[weibo-user-channel] 失败:", e)
  process.exit(1)
})
