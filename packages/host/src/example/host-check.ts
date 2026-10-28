/**
 * 宿主门面自检 —— 覆盖本轮新增/改动的字段:openExternal / dataSaver。
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
assert.equal(globalThis.appHost.dataSaver, undefined, "node 后端不设 dataSaver")

// ── js 后端契约:`(fnDecl, name, args)` 必须能执行「声明式函数 + 显式实参」 ──
// 曾误用 `(fnExpr)\nreturn name(arguments[0])` 形态 —— 括号把函数声明变表达式致名字不绑定
// (ReferenceError),`arguments[0]` 又依赖 wrapper 收实参(FunctionJsBackend 的 wrapper 不收)。
// 这里钉住后端支持「code=函数声明、fn=名字、args=显式实参」(YouTube 解 n 参数走此形态)。
assert.equal(typeof globalThis.appHost.js.call, "function", "node 后端应有 js")
assert.equal(
  globalThis.appHost.js.call("function twice(a){return a*2}", "twice", [21]),
  42,
  "js.call 应支持函数声明 + 显式实参(YouTube n 解密依赖此形态)",
)

// ── openExternal 协议白名单(安全边界) ──────────────────────────────────────
// URL 常来自远端 feed 正文的 `<a href>`。白名单在门面这一处,三个后端共用。
// ⚠️ 这些必须**同步抛出**(不是 await 才抛):兜底实现是 window.open,node 下会 ReferenceError,
// 所以「抛错」本身不能证明是白名单拦的 —— 用**错误消息**判。
for (const bad of [
  "file:///C:/Windows/System32/calc.exe",
  "javascript:alert(1)",
  "data:text/html,<h1>x",
  "ms-settings:",
  "not a url",
]) {
  await assert.rejects(() => globalThis.appHost.openExternal(bad), /已拦截/, `危险协议未被拦截: ${bad}`)
}
// 放行的协议不该被白名单拒(此处只断言错误**不是**「已拦截」那一类)。
for (const good of ["https://example.com/a", "http://example.com", "mailto:a@b.c"]) {
  const err = await globalThis.appHost.openExternal(good).then(
    () => null,
    (e: Error) => e,
  )
  assert.ok(err === null || !/已拦截/.test(err.message), `合法协议被误拦: ${good}`)
}

// ── browser 后端:同样应有 openExternal(继承兜底) ──
injectBrowserHost()
assert.equal(typeof globalThis.appHost.openExternal, "function", "browser 后端也应有 openExternal")
assert.equal(typeof globalThis.appHost.http.request, "function", "browser 后端应用 fetch 实现 http")

// 可写:app 层按 settings 写入渲染开关。
globalThis.appHost.dataSaver = true
assert.equal(globalThis.appHost.dataSaver, true, "dataSaver 可被 app 层覆盖")

console.log("✔ 宿主门面自检通过(openExternal 协议白名单 / dataSaver / js 契约)")
