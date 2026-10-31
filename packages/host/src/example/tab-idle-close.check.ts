/**
 * lane tab 空闲回收自检 —— `bun packages/host/src/example/tab-idle-close.check.ts`
 *
 * 背景(2026-11-01 任务管理器实测):整树 3 分钟空闲回收只在**整个浏览器**闲下来才触发;
 * 别的 lane 持续在用时,抖音/小红书这类重页面会一直常驻(单 tab 150–440MB)。
 * 这里用假 CDP(无网络)验证 `tabIdleCloseMs` 的生命周期:
 *   1. 空闲到点 → 关 target(内存释放的唯一手段),句柄保留;
 *   2. 有在途命令时不回收(长滚动/长轮询不被打断),结束后重新计时;
 *   3. 回收后再用 → 走既有「target 丢失自愈」重建(渠道按「页面被导航走」重新收首屏)。
 */

import assert from "node:assert/strict"

import { type BrowserDriver, CdpBrowserBackend } from "../browser/backend.ts"
import type { CdpConnector, CdpTransportHandlers } from "../browser/transport.ts"

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// ── 假 appHost.http:/json/* (backend 的 target 管理全走这里) ────────────────
interface FakeTarget {
  id: string
  type: string
  url: string
  webSocketDebuggerUrl: string
}
const targets = new Map<string, FakeTarget>()
let seq = 0
const closed: string[] = []

;(globalThis as Record<string, unknown>).appHost = {
  http: {
    request: async ({ url }: { url: string }) => {
      const u = new URL(String(url))
      if (u.pathname === "/json/version") {
        return { body: JSON.stringify({ webSocketDebuggerUrl: "ws://fake/browser" }) }
      }
      if (u.pathname === "/json/list") {
        return { body: JSON.stringify([...targets.values()]) }
      }
      if (u.pathname.startsWith("/json/close/")) {
        const id = decodeURIComponent(u.pathname.slice("/json/close/".length))
        if (targets.delete(id)) closed.push(id)
        return { body: "Closed" }
      }
      if (u.pathname.startsWith("/json/activate/")) return { body: "Activated" }
      throw new Error(`假 http 不认识的端点: ${url}`)
    },
  },
}

// ── 假 connector:按 method 回 canned result(Target.createTarget 顺便记账) ──
/** 挂起的命令(表达式含 "hang" 时不回,等 release)——验证「在途不回收」。 */
let releaseHanging: (() => void) | null = null

const connector: CdpConnector = {
  async connect(_wsUrl: string, handlers: CdpTransportHandlers) {
    return {
      async send(text: string) {
        const msg = JSON.parse(text) as { id: number; method: string; params?: { expression?: string } }
        let result: Record<string, unknown> = {}
        if (msg.method === "Target.createTarget") {
          const id = `t${++seq}`
          targets.set(id, { id, type: "page", url: "about:blank", webSocketDebuggerUrl: `ws://fake/${id}` })
          result = { targetId: id }
        } else if (msg.method === "Runtime.evaluate") {
          if (msg.params?.expression?.includes("hang")) {
            releaseHanging = () => handlers.onText(JSON.stringify({ id: msg.id, result: { result: { value: 42 } } }))
            return
          }
          result = { result: { value: 42 } }
        }
        queueMicrotask(() => handlers.onText(JSON.stringify({ id: msg.id, result })))
      },
      async close() {
        queueMicrotask(() => handlers.onClose("test close"))
      },
    }
  },
}

const driver: BrowserDriver = {
  async ensureReady() {
    return 9222
  },
  async close() {},
  tabIdleCloseMs: 60,
}

const backend = new CdpBrowserBackend({ driver, connector })
const tab = backend.tab("list:demo")

// 1) 首次使用:建 target + evaluate 走通。
assert.equal(await tab.evaluate("6*7"), 42, "evaluate 走通(建 target + 假 ws)")
assert.equal(targets.size, 1, "应创建了一个 lane target")

// 2) 在途命令不回收:evaluate 挂起期间过了两个回收周期,target 必须还在。
const hanging = tab.evaluate("hang()")
await sleep(150)
// TS 的控制流分析看不到回调里的赋值,会把 let 收窄成 null —— 断言前先显式还原联合类型。
const release = releaseHanging as (() => void) | null
assert.ok(release, "挂起命令应已到达假 transport")
await sleep(150)
assert.equal(closed.length, 0, "在途命令期间不得回收 tab(长滚动/长轮询不能被打断)")
release()
assert.equal(await hanging, 42, "挂起命令放行后正常返回")

// 3) 命令结束且空闲到点:关 target;句柄仍在 backend.tabs 里(再用即重建)。
await sleep(180)
assert.deepEqual(closed, [`t${seq}`], "空闲到点应关掉本 tab 的 target")
assert.equal(targets.size, 0, "target 关掉后 /json/list 里不应再有它")

// 4) 回收后再用:重建新 target,同一条 evaluate 语义不变。
assert.equal(await tab.evaluate("6*7"), 42, "回收后再用应自动重建并返回结果")
assert.equal(seq, 2, "重建 = 又建了一个新 target")
assert.equal(targets.size, 1, "重建后 target 回到列表里")

console.log("✔ lane tab 空闲回收自检通过(在途不回收 / 到点关闭 / 句柄保留 / 再用重建)")
