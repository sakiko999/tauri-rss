/**
 * 宿主门面自检 —— 覆盖本轮新增/改动的字段:openExternal / imageProxy / dataSaver。
 * 跑:`bun packages/host/src/example/host-check.ts`
 */
import assert from "node:assert/strict"
import { injectNodeHost, injectBrowserHost } from "../index.ts"

// ── node 后端:未注入 openExternal → 兜底(此处只断言不抛) ──
injectNodeHost()
assert.equal(typeof globalThis.appHost.http, "object", "node 后端应有 http")
assert.equal(typeof globalThis.appHost.openExternal, "function", "openExternal 门面必须存在(兜底也算)")

// node 环境没有真浏览器,openExternal 的兜底是 window.open —— 会抛(无 window)。
// 断言「有这个方法」而不是「调用成功」,避免测试环境依赖 GUI。
assert.equal(globalThis.appHost.imageProxy, undefined, "node 后端不设 imageProxy(默认开启由消费侧判定)")
assert.equal(globalThis.appHost.dataSaver, undefined, "node 后端不设 dataSaver")

// ── browser 后端:同样应有 openExternal(继承兜底) ──
injectBrowserHost()
assert.equal(typeof globalThis.appHost.openExternal, "function", "browser 后端也应有 openExternal")
assert.equal(typeof globalThis.appHost.http.request, "function", "browser 后端应用 fetch 实现 http")

// 可写:app 层按 settings 写入这两个渲染开关。
globalThis.appHost.imageProxy = false
globalThis.appHost.dataSaver = true
assert.equal(globalThis.appHost.imageProxy, false, "imageProxy 可被 app 层覆盖")

console.log("✔ 宿主门面自检通过(openExternal / imageProxy / dataSaver)")
