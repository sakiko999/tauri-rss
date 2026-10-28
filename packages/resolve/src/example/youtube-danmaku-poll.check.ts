/**
 * YouTube 直播聊天轮询退避自检 —— `bun packages/resolve/src/example/youtube-danmaku-poll.check.ts`
 *
 * 回归背景(2026-10-26 日志审计):轮询失败原来在 `.finally` 里无条件按 5s 重排,
 * 断网或直播结束后每 5s 一条 warn 永不停止;直播结束也不会终止轮询。
 */

import assert from "node:assert/strict"

import { isChatEndedError, nextPollDelay } from "../platform/youtube/danmaku.ts"

// 正常间隔:前两次沿用服务端 timeoutMs(首轮 + 首次失败)。
assert.equal(nextPollDelay(5000, 0), 5000)
assert.equal(nextPollDelay(5000, 1), 5000)

// 连续失败指数退避,封顶 60s(断网期间既不刷日志也不刷请求)。
assert.equal(nextPollDelay(5000, 2), 10_000)
assert.equal(nextPollDelay(5000, 3), 20_000)
assert.equal(nextPollDelay(5000, 5), 60_000, "超过上限应封顶")
assert.equal(nextPollDelay(20, 3), 80)

// 只有「continuations 用尽」才终止;瞬时无 continuation 仍走退避重试。
assert.equal(isChatEndedError("youtube live chat: 直播结束(无下一 continuation)"), true)
assert.equal(isChatEndedError("youtube live chat: 无 continuation(直播结束?)"), false)
assert.equal(isChatEndedError("网络中断"), false)

console.log("✔ youtube danmaku 轮询自检通过(退避 / 封顶 / 结束判定)")
