/**
 * 异步确认框 store 自检 —— `bun apps/desktop/src/lib/confirm.check.ts`
 *
 * 守的是「请求丢失 / Promise 永不 resolve」：危险操作（重置、清缓存、退订）都写成
 * `if (!(await confirmAction(...))) return`，请求排错队就会静默卡住或误执行。
 */

import assert from "node:assert/strict"

import { confirmAction, getConfirmRequest, settleConfirm, subscribeConfirm } from "./confirm.ts"

let notified = 0
const unsubscribe = subscribeConfirm(() => {
  notified += 1
})

const first = confirmAction({ title: "删除？", danger: true })
assert.equal(getConfirmRequest()?.title, "删除？")
assert.equal(notified, 1, "首个请求应立即通知宿主")
assert.equal(getConfirmRequest()?.danger, true, "选项要原样带给宿主")

const second = confirmAction({ title: "重置？", desc: "不可撤销" })
assert.equal(getConfirmRequest()?.title, "删除？", "并发请求排队，不覆盖当前")

settleConfirm(true)
assert.equal(await first, true, "确认解析为 true")
assert.equal(getConfirmRequest()?.title, "重置？", "队列里的下一个顶上")
assert.equal(notified, 2, "换请求要通知宿主")

settleConfirm(false)
assert.equal(await second, false, "取消解析为 false")
assert.equal(getConfirmRequest(), null, "队列空了")

settleConfirm(true) // 没有请求时是 no-op，不能抛
unsubscribe()
console.log("✔ 确认框 store 自检通过（排队 / 解析 / 通知 / 空队列 no-op）")
