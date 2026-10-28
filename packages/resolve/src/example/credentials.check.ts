/**
 * credentials provider 自检 —— `bun packages/resolve/src/example/credentials.check.ts`
 *
 * cookie 链第 3→4 跳(渠道 → client 每个调用点)曾靠人肉传参,三次漏传案底:
 * bili:user_video(登录也 412)/ bili:favlist 私有夹 / douyinCookie 死键。
 * provider 让 client 在调用点未显式传 cookie 时回落宿主注册的 settings 登录态。
 * 锁定:①三级语义(显式 > 空串强制匿名 > provider);②bili sign 家族同接(签名与
 * 请求同 cookie);③douyin 兜底序(登录 cookie > 匿名 ttwid jar);④xhs 空串退出。
 */

import assert from "node:assert/strict"

import { biliClient } from "../platform/bili/client.ts"
import { setPlatformCookieLookup } from "../platform/credentials.ts"
import { douyinClient, douyinCookie } from "../platform/douyin/client.ts"
import { weiboClient } from "../platform/weibo/client.ts"
import { xhsClient } from "../platform/xhs/client.ts"

interface Captured {
  url: string
  headers: Record<string, string>
}
const captured: Captured[] = []

const IMG_KEY = "a".repeat(32)
const SUB_KEY = "b".repeat(32)

;(globalThis as unknown as { appHost: unknown }).appHost = {
  now: () => 1_700_000_000_000,
  js: { call: () => "" }, // douyin getJson 的 ABogus 签名走 appHost.js(此处不需要真签名)
  http: {
    request: async (req: { url: string; headers?: Record<string, string> }) => {
      captured.push({ url: req.url, headers: req.headers ?? {} })
      const body = req.url.includes("/x/web-interface/nav")
        ? {
            code: 0,
            data: {
              wbi_img: {
                img_url: `https://i0.hdslb.com/bfs/wbi/${IMG_KEY}.png`,
                sub_url: `https://i0.hdslb.com/bfs/wbi/${SUB_KEY}.png`,
              },
            },
          }
        : { code: 0, data: {} }
      return { status: 200, headers: {}, body: JSON.stringify(body) }
    },
  },
}

// ── ① bili:未显式传 cookie → provider 登录态生效;空串 → 强制匿名 ──
setPlatformCookieLookup((p) => (p === "bili" ? "SESSDATA=PROVIDER" : undefined))
{
  captured.length = 0
  await biliClient.getJson("https://api.bilibili.com/x/web-interface/view?bvid=BV1x")
  assert.match(lastHeader("cookie") ?? "", /SESSDATA=PROVIDER/, "未传 cookie 必须回落 provider")

  captured.length = 0
  await biliClient.getJson("https://api.bilibili.com/x/web-interface/view?bvid=BV1x", { cookie: "SESSDATA=EXPLICIT" })
  assert.match(lastHeader("cookie") ?? "", /SESSDATA=EXPLICIT/, "显式 cookie 必须覆盖 provider")
  assert.doesNotMatch(lastHeader("cookie") ?? "", /PROVIDER/, "显式覆盖时不得混入 provider 值")

  captured.length = 0
  await biliClient.getJson("https://api.bilibili.com/x/web-interface/view?bvid=BV1x", { cookie: "" })
  assert.equal(lastHeader("cookie"), undefined, "显式空串 = 强制匿名,不得回落 provider")
}

// ── ② bili sign 家族同接:signWeb 不传 cookie 时签名用 provider cookie 的 nav ──
{
  captured.length = 0
  await biliClient.signWeb("mid=1")
  const navCookie = captured.find((c) => c.url.includes("/x/web-interface/nav"))?.headers["cookie"]
  assert.match(
    navCookie ?? "",
    /SESSDATA=PROVIDER/,
    "signWeb 必须与请求同源回落 provider(签名/请求 cookie 错配会认证错 mid)",
  )

  captured.length = 0
  await biliClient.signSpace("mid=1", "")
  assert.ok(
    !captured.some((c) => c.url.includes("/x/web-interface/nav") && (c.headers["cookie"] ?? "").includes("PROVIDER")),
    "signSpace 空串必须强制匿名",
  )
}

// ── ③ douyin:登录 cookie > 匿名 ttwid jar;显式空串 → 匿名 ttwid ──
setPlatformCookieLookup((p) => (p === "douyin" ? "ttwid=LOGIN; sessionid=1" : undefined))
{
  captured.length = 0
  await douyinClient.getJson("https://live.douyin.com/webcast/room/web/enter/?aid=1")
  assert.match(lastHeader("cookie") ?? "", /ttwid=LOGIN/, "douyin 未传 cookie 必须用登录 cookie(曾整平台死键)")
  const warm = await douyinCookie()
  assert.match(warm, /ttwid=LOGIN/, "douyinCookie() 必须 provider 感知(stream/弹幕路径经它取登录态)")

  captured.length = 0
  await douyinClient.getJson("https://live.douyin.com/webcast/room/web/enter/?aid=1", { cookie: "" })
  const ck = lastHeader("cookie") ?? ""
  assert.ok(!ck.includes("LOGIN"), "douyin 显式空串 = 匿名(不得带登录 cookie)")
  assert.ok(ck.includes("ttwid="), "douyin 匿名也必须带 ttwid(缺则 415)")
}

// ── ④ weibo / xhs:provider 回落 + 空串退出 ──
setPlatformCookieLookup((p) => (p === "weibo" ? "SUB=WB" : p === "xhs" ? "web_session=XHS" : undefined))
{
  captured.length = 0
  await weiboClient.getJson("https://m.weibo.cn/api/container/getIndex?containerid=1")
  assert.match(lastHeader("Cookie") ?? "", /SUB=WB/, "weibo 未传 cookie 必须回落 provider")

  captured.length = 0
  await weiboClient.getJson("https://m.weibo.cn/api/container/getIndex?containerid=1", { cookie: "" })
  assert.equal(lastHeader("Cookie"), undefined, "weibo 显式空串 = 强制匿名")

  captured.length = 0
  await xhsClient.getHtml("https://www.xiaohongshu.com/explore/x")
  assert.match(lastHeader("Cookie") ?? "", /web_session=XHS/, "xhs getHtml 未传 cookie 必须回落 provider")

  captured.length = 0
  await xhsClient.getHtml("https://www.xiaohongshu.com/explore/x", { cookie: "" })
  assert.equal(lastHeader("Cookie"), undefined, "xhs 显式空串 = 强制匿名(详情刻意不出账号 cookie)")
}

// ── ⑤ 注销 provider → 行为回到纯显式 ──
setPlatformCookieLookup(null)
{
  captured.length = 0
  await weiboClient.getJson("https://m.weibo.cn/api/container/getIndex?containerid=1")
  assert.equal(lastHeader("Cookie"), undefined, "provider 注销后不得再注入")
}

console.log("✔ credentials 自检通过(三级语义 / sign 家族同接 / douyin 兜底序 / xhs 空串退出 / 注销)")

function lastHeader(name: string): string | undefined {
  return [...captured].reverse().find((c) => c.headers[name] !== undefined)?.headers[name]
}
