/**
 * bili space 系接口风控自检 —— `bun packages/resolve/src/example/bili-space-sign.check.ts`
 *
 * 2026-10 起只带 wbi 签名 + buvid 的 `x/space/wbi/arc/search` 大量 HTTP 412(WAF)/
 * -352:必须补 `dm_*` 客户端指纹参数(参与签名),且请求要带 cookie(匿名已被收紧,
 * 曾因 user_video 漏传 info.cookie,登录用户也永远匿名 → 间歇 412)。
 * 本自检锁定:signSpace 输出含全部 dm_* 参数、签名覆盖它们、wts 为秒级。
 */
import assert from "node:assert/strict"

import { biliClient, MIXIN_KEY_ENC_TAB } from "../platform/bili/client.ts"
import { md5Hex } from "../utils/md5.ts"

const IMG_KEY = "a".repeat(32)
const SUB_KEY = "b".repeat(32)

const navWithCookie: string[] = []
;(globalThis as unknown as { appHost: unknown }).appHost = {
  now: () => 1_700_000_000_123,
  http: {
    request: async (req: { url: string; headers?: Record<string, string> }) => {
      if (req.url.includes("/x/web-interface/nav")) navWithCookie.push(req.headers?.["cookie"] ?? "")
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          code: 0,
          data: {
            wbi_img: {
              img_url: `https://i0.hdslb.com/bfs/wbi/${IMG_KEY}.png`,
              sub_url: `https://i0.hdslb.com/bfs/wbi/${SUB_KEY}.png`,
            },
          },
        }),
      }
    },
  },
}

// 1. signSpace 输出:dm_* 全在、w_rid/wts 在、wts 为秒级时间戳。
const signed = await biliClient.signSpace("mid=42&ps=30&pn=1&platform=web&order=pubdate")
for (const k of ["dm_img_list=", "dm_img_str=", "dm_cover_img_str=", "dm_img_inter=", "w_rid=", "wts="]) {
  assert.ok(signed.includes(k), `signSpace 输出必须包含 ${k}`)
}
const wts = new URLSearchParams(signed).get("wts") ?? ""
assert.match(wts, /^\d{10}$/, "wts 必须是秒级时间戳")

// 2. 签名覆盖 dm_*:按同一算法重算 w_rid(混排 key 来自 nav 的 img/sub key)。
//    若未来把 dm_* 移出签名串,这里会失配(平台签名校验同理会拒)。
const sp = new URLSearchParams(signed)
const wRid = sp.get("w_rid") ?? ""
sp.delete("w_rid")
sp.delete("wts") // 签名串里 wts 不参与排序,拼接在排序结果之后(与 signWeb 一致)
sp.sort()
const origin = IMG_KEY + SUB_KEY
const mixin = MIXIN_KEY_ENC_TAB.map((i) => origin[i] ?? "")
  .join("")
  .slice(0, 32)
assert.equal(wRid, md5Hex(`${sp.toString()}&wts=${wts}${mixin}`), "w_rid 必须覆盖含 dm_* 的全参数")

// 3. 带 cookie 时签名用同 cookie 的 nav(登录态 key 选择)。
navWithCookie.length = 0
await biliClient.signSpace("mid=42", "SESSDATA=abc")
assert.equal(navWithCookie.at(-1), "SESSDATA=abc", "signSpace(cookie) 的 nav 必须带同一 cookie")

console.log("✔ bili space 签名自检通过(dm_* 指纹在签名串内 / wts 秒级 / cookie 传递)")
