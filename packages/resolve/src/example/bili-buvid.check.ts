/**
 * bili 登录 cookie 的 buvid 兜底自检 —— `bun packages/resolve/src/example/bili-buvid.check.ts`
 *
 * 扫码登录只回收 passport 的 Set-Cookie(SESSDATA/bili_jct/DedeUserID/sid),**不含
 * buvid3/buvid4**;而 `getListByArea` / space 系接口对无 buvid 的请求直接 -352。
 * 所以 `{ cookie, buvid: true }` 必须把匿名 buvid 补进去 —— 不能「有 cookie 就跳过」。
 * 曾因此在扫码登录后从可用变成 352(全局 L0 也照报,因为 --352 是平台返回,不是冷却)。
 */

import assert from "node:assert/strict"

import { biliClient } from "../platform/bili/client.ts"

interface Captured {
  url: string
  headers: Record<string, string>
}

const captured: Captured[] = []

/** 只返回最小可用 payload:finger/spi 给 buvid,其余给 code 0。 */
;(globalThis as unknown as { appHost: unknown }).appHost = {
  now: () => 1_700_000_000_000,
  http: {
    request: async (req: { url: string; headers?: Record<string, string> }) => {
      captured.push({ url: req.url, headers: req.headers ?? {} })
      const body = req.url.includes("/x/frontend/finger/spi")
        ? { code: 0, data: { b_3: "ANON_B3", b_4: "ANON_B4" } }
        : { code: 0, data: {} }
      return { status: 200, headers: {}, body: JSON.stringify(body) }
    },
  },
}

const AREA = "https://api.live.bilibili.com/xlive/web-interface/v1/second/getListByArea"
const lastCookie = (): string => [...captured].reverse().find((c) => c.url === AREA)?.headers["cookie"] ?? ""

// 1. 登录 cookie(无 buvid3)+ buvid:true → 补匿名 buvid,且保留登录凭证。
{
  await biliClient.getJson(AREA, { cookie: "SESSDATA=abc; bili_jct=xyz", buvid: true })
  const cookie = lastCookie()
  assert.match(cookie, /SESSDATA=abc/, "登录 cookie 必须保留")
  assert.match(cookie, /buvid3=ANON_B3/, "缺 buvid3 时必须补匿名指纹")
  assert.match(cookie, /buvid4=ANON_B4/)
}

// 2. cookie 已带 buvid3 → 不重复追加(尊重 profile 里的真实指纹)。
{
  captured.length = 0
  await biliClient.getJson(AREA, { cookie: "SESSDATA=abc; buvid3=OWN_B3; buvid4=OWN_B4", buvid: true })
  const cookie = lastCookie()
  assert.match(cookie, /buvid3=OWN_B3/)
  assert.doesNotMatch(cookie, /ANON_B3/, "已有 buvid3 时不得再补匿名指纹")
}

// 3. 无 cookie + buvid:true → 仍补匿名指纹(原行为不变)。
{
  captured.length = 0
  await biliClient.getJson(AREA, { buvid: true })
  assert.match(lastCookie(), /buvid3=ANON_B3/)
}

console.log("✔ bili buvid 兜底自检通过(登录 cookie 缺 buvid3 时补匿名指纹 / 已有则不重复 / 匿名照补)")
