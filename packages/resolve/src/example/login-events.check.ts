/**
 * 登录 / 弹幕日志事件自检 —— `bun packages/resolve/src/example/login-events.check.ts`
 *
 * 回归背景(2026-10-26 日志审计):登录生命周期原来三条路径三种写法(xhs/weibo 模板、
 * douyin 自由 info、bili:login 无 events),grep 一次登录得试三种措辞。现在各域
 * spread 同一份 `LOGIN_EVENTS` / `DANMAKU_EVENTS`,本文件把「同形」钉死。
 */
import assert from "node:assert/strict"
import { setLogSink } from "@amoeba/log"
import { log } from "../log.ts"

const lines: string[] = []
setLogSink((_level, text) => lines.push(text))
const take = (): string[] => {
  const out = [...lines]
  lines.length = 0
  return out
}

const LOGIN_DOMAINS = [
  ["bili:login", log.biliLogin],
  ["douyin", log.douyin],
  ["xhs", log.xhs],
  ["weibo", log.weibo],
] as const

for (const [name, domain] of LOGIN_DOMAINS) {
  take()
  domain.loginNavigate({ url: "https://example.test/login?token=abc" })
  domain.qrReady()
  domain.loginOk({})
  domain.loginOk({ user_id: "u1" })
  domain.loginReused()
  domain.loginTimeout()
  domain.loginFallback({ reason: "network down" })
  const got = take().map((t) => t.replace(new RegExp(`^\\[${name}\\] `), ""))

  assert.deepEqual(got, [
    "扫码登录导航 https://example.test/login?token=abc",
    "二维码已就绪(可扫码)",
    "登录成功",
    "登录成功 · user_id=u1",
    "已登录(复用 profile)",
    "扫码登录超时或二维码已失效",
    "HTTP 路径失败,回退浏览器: network down",
  ], `${name} 的登录事件文案与其他平台不一致`)
}

// 弹幕初始化失败:各直播域同一句(避免四处复制、措辞漂移)。
const DANMAKU_DOMAINS = [
  ["bili:live", log.biliLive],
  ["douyin", log.douyin],
  ["huya", log.huya],
  ["youtube", log.youtube],
] as const

for (const [name, domain] of DANMAKU_DOMAINS) {
  take()
  domain.danmakuInitFailed({ error: "WS 415" })
  assert.deepEqual(take(), [`[${name}] 弹幕初始化失败(未开播?): WS 415`], `${name} 的弹幕初始化文案不一致`)
}

// bili:login 曾经没有 events:确认它真的有模板方法(而不是靠自由 info 兜底)。
assert.equal(typeof log.biliLogin.loginOk, "function")
assert.equal(typeof log.biliLive.danmakuInitFailed, "function")

console.log("✔ 登录 / 弹幕日志事件自检通过(四平台同形 + 文案一致)")
