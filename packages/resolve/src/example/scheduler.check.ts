/**
 * browser lane 调度自检 —— `bun packages/resolve/src/example/scheduler.check.ts`
 *
 * 风控 §3.13.1 的验收项(假 backend,无网络):
 *   1. hidden 下两 lane 可并发(不再有全局锁);
 *   2. interactive 渲染租约:首个切 interactive、并行租约不反复切换、最后一个释放才 hidden、
 *      异常路径必释放;
 *   3. gate(platform)按平台串行,且等待不占 op lane 锁;
 *   4. 同 lane 串行(导航+fetch 原子),withBrowserOp 把 fn 打到对应 lane 的 tab 上;
 *   5. abortTabs 不跨 lane(keepLogin 跳过 login:*)。
 */
import assert from "node:assert/strict"
import { withLane, withRenderLease, withBrowserGlobal } from "../browser/scheduler.ts"
import { withBrowserOp } from "../browser/cdp.ts"
import { setPlatformCookieLookup } from "../platform/credentials.ts"
setPlatformCookieLookup(null)

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** 假 backend:记录 setMode 调用,tab(key) 产独立句柄并记录 activate/abort。 */
function fakeBrowser() {
  const modes: string[] = []
  const tabs = new Map<string, {
    activations: number
    aborted: string[]
    inflight: (() => void)[]
  }>()
  const browser: BrowserBackend = {
    async evaluate<T>(expr: string): Promise<T> {
      return `'${expr}'` as unknown as T
    },
    async getCookies() {
      return {}
    },
    async setMode(mode) {
      modes.push(mode)
    },
    async close() {},
    tab(key: string) {
      let t = tabs.get(key)
      if (!t) {
        t = { activations: 0, aborted: [], inflight: [] }
        tabs.set(key, t)
      }
      return {
        key,
        async evaluate<T>(expr: string): Promise<T> {
          return `[${key}]'${expr}'` as unknown as T
        },
        async getCookies() {
          return {}
        },
        async activate() {
          t!.activations++
        },
        async close() {},
        abortPending(reason: string) {
          t!.aborted.push(reason)
        },
      }
    },
    abortTabs(reason: string, opts?: { keepLogin?: boolean }) {
      for (const [key, t] of tabs) {
        if (opts?.keepLogin && key.startsWith("login:")) continue
        t.aborted.push(reason)
      }
    },
  }
  return { browser, modes, tabs }
}

// 1. hidden 下两 lane 并发:总耗时 ≈ 单次(而非串行两倍),且不触发 setMode。
{
  const { browser, modes } = fakeBrowser()
  const t0 = Date.now()
  await Promise.all([
    withBrowserOp(browser, { lane: "list:a" }, () => sleep(150)),
    withBrowserOp(browser, { lane: "list:b" }, () => sleep(150)),
  ])
  const wall = Date.now() - t0
  assert.ok(wall < 280, `两 lane 应并发(实测 ${wall}ms,串行会 ≥300ms)`)
  assert.deepEqual(modes, [], "hidden 操作不得触发 setMode")
}

// 2. 同 lane 串行 + fn 打到对应 lane 的 tab。
{
  const { browser, tabs } = fakeBrowser()
  const order: string[] = []
  await Promise.all([
    withBrowserOp(browser, { lane: "list:a" }, async (b) => {
      order.push("a1-start")
      await sleep(60)
      order.push("a1-end")
      return b.evaluate("x")
    }),
    withBrowserOp(browser, { lane: "list:a" }, async (b) => {
      order.push("a2-start")
      return b.evaluate("y")
    }),
  ])
  assert.deepEqual(order, ["a1-start", "a1-end", "a2-start"], "同 lane 必须串行")
  const r = await withBrowserOp(browser, { lane: "list:a" }, (b) => b.evaluate<string>("q"))
  assert.ok(r.startsWith("[list:a]"), `fn 必须打到本 lane 的 tab(得 ${r})`)
  assert.ok(tabs.has("list:a"), "宿主 tab(key) 按 lane 建句柄")
}

// 3. interactive 渲染租约:首个 interactive、并行租约不切换、最后释放才 hidden。
{
  const { browser, modes } = fakeBrowser()
  await Promise.all([
    withBrowserOp(browser, { lane: "list:a", mode: "interactive" }, () => sleep(120)),
    withBrowserOp(browser, { lane: "list:b", mode: "interactive" }, () => sleep(60)),
  ])
  assert.deepEqual(modes, ["interactive", "hidden"], `租约只该切换两次(得 ${JSON.stringify(modes)})`)
}

// 4. 租约异常路径必释放(后续租约仍能拿到 interactive)。
{
  const { browser, modes } = fakeBrowser()
  await assert.rejects(
    withBrowserOp(browser, { lane: "list:a", mode: "interactive" }, async () => {
      throw new Error("boom")
    }),
    /boom/,
  )
  await withBrowserOp(browser, { lane: "list:b", mode: "interactive" }, () => Promise.resolve())
  assert.deepEqual(modes, ["interactive", "hidden", "interactive", "hidden"], `异常必须释放租约(得 ${JSON.stringify(modes)})`)
}

// 5. gate:同平台串行(gate lane),且 gate 等待不占 op lane 锁。
{
  const { browser } = fakeBrowser()
  const gates: string[] = []
  ;(globalThis as unknown as { appHost: unknown }).appHost = {
    now: () => Date.now(),
    http: { request: async () => ({ status: 200, headers: {}, body: "" }) },
    net: {
      async browserGate(platform: string) {
        gates.push(`${platform}-start`)
        await sleep(60)
        gates.push(`${platform}-end`)
      },
    },
  }
  // 同平台两次 op:gate 串行(x1 与 x2 不交错);gate 不占 op lane —— b 在 gate 里等
  // 的时候,a 的 fn 应已在自己的 lane 上跑起来(gate 等待发生在 op lane 锁外)。
  await Promise.all([
    withBrowserOp(browser, { lane: "list:a", platform: "x" }, async () => {
      await sleep(30)
      gates.push("fn-a")
    }),
    withBrowserOp(browser, { lane: "list:b", platform: "x" }, async () => {
      gates.push("fn-b")
    }),
  ])
  const s = gates.indexOf("x-start")
  const e = gates.indexOf("x-end")
  const s2 = gates.indexOf("x-start", e)
  const e2 = gates.indexOf("x-end", s2)
  assert.ok(s >= 0 && e > s && s2 > e && e2 > s2, `同平台 gate 必须串行(${gates.join(",")})`)
  assert.ok(
    gates.indexOf("fn-a") > s2 && gates.indexOf("fn-a") < e2,
    `gate 等待不得占 op lane(a 的 fn 应在 b 持 gate 期间执行)(${gates.join(",")})`,
  )
}

// 6. abortTabs:keepLogin 跳过 login:* lane;单 tab abortPending 不跨 lane。
{
  const { browser, tabs } = fakeBrowser()
  await withBrowserOp(browser, { lane: "list:a" }, () => Promise.resolve())
  await withBrowserOp(browser, { lane: "login:xhs" }, () => Promise.resolve())
  browser.abortTabs?.("timeout", { keepLogin: true })
  assert.deepEqual(tabs.get("list:a")?.aborted, ["timeout"], "非登录 lane 必须被中止")
  assert.deepEqual(tabs.get("login:xhs")?.aborted, [], "login lane 必须被豁免")
}

// 7. withRenderLease / withBrowserGlobal 原语直用:异常释放 + 全局互斥。
{
  const { browser, modes } = fakeBrowser()
  await assert.rejects(withRenderLease(browser, async () => Promise.reject(new Error("x"))), /x/)
  assert.deepEqual(modes, ["interactive", "hidden"], "withRenderLease 异常必须释放")
  const order: string[] = []
  await Promise.all([
    withBrowserGlobal(async () => {
      order.push("g1-start")
      await sleep(40)
      order.push("g1-end")
    }),
    withBrowserGlobal(async () => {
      order.push("g2-start")
    }),
  ])
  assert.deepEqual(order, ["g1-start", "g1-end", "g2-start"], "browser:global 必须互斥")
}

// 8. withLane:前驱失败不传染,fn 异常原样抛出。
{
  await assert.rejects(withLane("t", async () => Promise.reject(new Error("first"))), /first/)
  const r = await withLane("t", async () => "after")
  assert.equal(r, "after", "前驱失败不得卡死后续")
}

console.log("✔ scheduler 自检通过(并发 lane / 租约计数 / gate 串行不占 lane / 异常释放 / abort 豁免登录)")
