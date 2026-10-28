/**
 * 路由表自检 —— `bun packages/resolve/src/example/router.check.ts`
 * 守护:host 边界(伪造子串域名不误命中) + 各平台正例命中 + 提取 id 正确。
 */

import { resolveRoute } from "../resolver/router.ts"

let fails = 0
const ok = (c: unknown, l: string) => {
  if (c) console.log(`  ✓ ${l}`)
  else {
    fails++
    console.error(`  ✗ ${l}`)
  }
}

const hit = (url: string, platform: string, kind: string, id: string) => {
  const r = resolveRoute(url)
  ok(
    r?.platform === platform && r?.kind === kind && r?.id === id,
    `${url} → ${platform}/${kind}/${id}（得 ${JSON.stringify(r)}）`,
  )
}
const miss = (url: string, why: string) => ok(resolveRoute(url) === null, `${url} 不命中（${why}）`)

console.log("正例:")
hit("https://www.bilibili.com/video/BV1xx411c7mD", "bilibili", "video", "BV1xx411c7mD")
hit("https://www.bilibili.com/video/av12345", "bilibili", "video", "av12345")
hit("https://live.bilibili.com/7734200", "bilibili", "live", "7734200")
hit("https://www.youtube.com/watch?v=abc123", "youtube", "video", "abc123")
hit("https://youtu.be/xyz789", "youtube", "video", "xyz789")
hit("https://www.huya.com/60066", "huya", "live", "60066")
hit("https://www.douyu.com/9999", "douyu", "live", "9999")
hit("https://live.douyin.com/3010151431", "douyin", "live", "3010151431")

console.log("host 边界(伪造子串域名不误命中):")
miss("https://notyoutube.com/watch?v=x", "notyoutube.com")
miss("https://fakehuya.com/123", "fakehuya.com")
miss("https://mydouyu.com/456", "mydouyu.com")
miss("https://evilbilibili.com/video/BV1x", "evilbilibili.com")
miss("https://evil-live.douyin.com/123", "evil-live.douyin.com")
miss("https://notlive.douyin.com/123", "notlive.douyin.com")
miss("https://example.com/page", "无关域")

console.log("非 url / 空:")
miss("", "空串")
miss("not-a-url", "非 url")

console.log(fails === 0 ? "\n全部通过" : `\n${fails} 项失败`)
process.exit(fails === 0 ? 0 : 1)
