/**
 * Electron CDP 代理载具自检 —— `bun packages/host/src/example/browser-cdp-driver.check.ts`
 *
 * 用一个最小 CDP 服务器（HTTP /json/* + WS browser/page 端点）模拟
 * electron-tabs-demo 的 rss-service CDP 代理，验证 `createCdpPortBrowser`：
 *   - ensureReady 固定端口（不拉起任何进程）；
 *   - 默认页 evaluate / getCookies 走通；
 *   - lane tab → Target.createTarget → 独立 page 连接 → evaluate；
 *   - driver.close → POST /amoeba/close-targets（空闲回收语义）；
 *   - resetProfile → POST /amoeba/reset-profile。
 *
 * 这是 host 侧契约自检；Electron 代理的真身（隐藏 BrowserWindow + webContents.debugger）
 * 由 electron-tabs-demo 的宿主 smoke 覆盖。
 */

import assert from "node:assert/strict"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { WebSocketServer } from "ws"

import { createCdpPortBrowser } from "../node/browser-cdp.ts"

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// ── 最小 CDP 服务器 ────────────────────────────────────────────────────────
interface Target {
  id: string
  url: string
}

const targets = new Map<string, Target>()
let seq = 0
let closeAllCalls = 0
let resetProfileCalls = 0
let port = 0

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", "http://127.0.0.1")
  const json = (body: unknown): void => {
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify(body))
  }
  if (url.pathname === "/json/version") {
    json({ Browser: "MockElectron/45", webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser` })
    return
  }
  if (url.pathname === "/json/list") {
    json(
      [...targets.values()].map((t) => ({
        id: t.id,
        type: "page",
        url: t.url,
        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/${t.id}`,
      })),
    )
    return
  }
  if (url.pathname.startsWith("/json/close/")) {
    targets.delete(decodeURIComponent(url.pathname.slice("/json/close/".length)))
    res.end("Closed")
    return
  }
  if (url.pathname.startsWith("/json/activate/")) {
    res.end("Activated")
    return
  }
  if (url.pathname === "/amoeba/close-targets" && req.method === "POST") {
    closeAllCalls += 1
    const n = targets.size
    targets.clear()
    json({ closed: n })
    return
  }
  if (url.pathname === "/amoeba/reset-profile" && req.method === "POST") {
    resetProfileCalls += 1
    json({ profile: "mock:rss-crawler" })
    return
  }
  res.writeHead(404).end()
}

const server = createServer(handleRequest)

const wss = new WebSocketServer({ noServer: true })
server.on("upgrade", (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req)
  })
})

wss.on("connection", (ws) => {
  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString()) as {
      id?: number
      method?: string
      params?: { expression?: string }
    }
    if (msg.id === undefined) return
    const reply = (result: unknown) => ws.send(JSON.stringify({ id: msg.id, result }))
    switch (msg.method) {
      case "Target.createTarget": {
        const id = `t${++seq}`
        targets.set(id, { id, url: "about:blank" })
        reply({ targetId: id })
        return
      }
      case "Target.closeTarget":
        reply({ success: true })
        return
      case "Runtime.evaluate": {
        const expression = msg.params?.expression ?? ""
        const value = expression.includes("navigator.userAgent") ? "MockChrome/1.0" : 42
        reply({ result: { value } })
        return
      }
      case "Network.getAllCookies":
      case "Network.getCookies":
        reply({ cookies: [{ name: "web_session", value: "abc123" }] })
        return
      default:
        reply({})
    }
  })
})

await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
port = (server.address() as AddressInfo).port

// ── 被测载具 ───────────────────────────────────────────────────────────────
// backend 的 /json/* 请求走 appHost.http —— 自检里用 fetch 兜底实现。
;(globalThis as Record<string, unknown>).appHost = {
  http: {
    request: async ({ url, method }: { url: string; method?: string }) => {
      const res = await fetch(String(url), { method: method ?? "GET" })
      return { body: await res.text() }
    },
  },
}

const backend = createCdpPortBrowser({ port, idleCloseMs: 0, tabIdleCloseMs: 0 })

// 1) 默认页：evaluate 走代理（browser 级 Target.createTarget + page WS evaluate）。
assert.equal(await backend.evaluate("6*7"), 42, "默认页 evaluate 走通")

// 2) cookie 经 Network.getAllCookies（HttpOnly 语义同真实代理）。
const cookies = await backend.getCookies()
assert.equal(cookies.web_session, "abc123", "getCookies 走通")

// 3) lane tab：独立 target + 独立连接（Target.createTarget 映射隐藏窗口）。
const tab = backend.tab("list:demo")
assert.equal(await tab.evaluate("navigator.userAgent"), "MockChrome/1.0", "lane tab evaluate 走通")
assert.ok(targets.size >= 1, "应创建了 lane target")

// 4) 空闲回收语义：driver.close = 让代理关全部托管窗口（不杀进程）。
await backend.close()
assert.equal(closeAllCalls, 1, "close 应 POST /amoeba/close-targets")
assert.equal(targets.size, 0, "全部托管 target 已关闭")

// 5) profile 重置语义。
const profile = await backend.resetProfile()
assert.equal(resetProfileCalls, 1, "resetProfile 应 POST /amoeba/reset-profile")
assert.equal(profile, "mock:rss-crawler", "resetProfile 返回代理给的 profile 标识")

await sleep(10)
await new Promise<void>((r) => server.close(() => r()))
console.log("browser-cdp-driver check OK")
