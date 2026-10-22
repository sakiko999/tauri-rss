/**
 * 启动 cookie 快照同步自检(DataLayer.syncBrowserCookies)。
 *
 * 覆盖:
 *   1. 有启用订阅 + 浏览器有登录标记 → 按平台写 settings,并同步 credentials provider 快照;
 *   2. 同平台多渠道(xhs:user / xhs:explore)只读一次(按 cookieFieldFor 去重);
 *   3. 浏览器没有登录标记 → 不清空 settings;
 *   4. 同步期间用户手改同字段(compare-and-set)→ 放弃本次写入;
 *   5. weibo 优先 m.weibo.cn,缺失时才回落 weibo.com;
 *   6. 没有该平台订阅 → 不读浏览器;
 *   7. 只有**停用**订阅 → 不读浏览器;
 *   8. 只有 xhs 订阅(桌面无 HTTP 消费方)→ 不单独拉起浏览器。
 *
 * 跑:`bun packages/core/src/example/cookie-sync.check.ts`
 * 用内存存储 + 假 browser.getCookies,不触网、不启动浏览器。
 */
import assert from "node:assert/strict"
import { injectNodeHost } from "@amoeba/host"
import { resolveCookie, XHS_BASE } from "@amoeba/resolve"
import { createDataLayer } from "../index.ts"
import type { Subscription } from "../types/subscription.ts"

injectNodeHost()

let fakeXhs: Record<string, string> = { id_token: "id-1", web_session: "ws-1", a1: "a1-1" }
let fakeWeiboMobile: Record<string, string> = { SUB: "sub-m", SUBP: "subp-m", _T_WM: "wm" }
let fakeWeiboDesktop: Record<string, string> = { SUB: "sub-d" }
let xhsReads = 0
let weiboMobileReads = 0
let weiboDesktopReads = 0
/** 下一次 m.weibo.cn 读取前执行(模拟读期间用户手改设置)。 */
let beforeWeiboRead: (() => Promise<void>) | null = null

Object.defineProperty(globalThis.appHost, "browser", {
  configurable: true,
  value: {
    async getCookies(url?: string): Promise<Record<string, string>> {
      if (url === XHS_BASE) {
        xhsReads++
        return { ...fakeXhs }
      }
      if (url === "https://m.weibo.cn") {
        weiboMobileReads++
        if (beforeWeiboRead) {
          const fn = beforeWeiboRead
          beforeWeiboRead = null
          await fn()
        }
        return { ...fakeWeiboMobile }
      }
      if (url === "https://weibo.com") {
        weiboDesktopReads++
        return { ...fakeWeiboDesktop }
      }
      return {}
    },
  },
})

const dl = createDataLayer()
const t = Date.now()

function sub(id: string, channelKey: string): Subscription {
  return { id, channelKey, title: id, enabled: true, info: {}, createdAt: t, updatedAt: t }
}

await dl.subscriptions.add(sub("sub-xhs", "xhs:user"))
await dl.subscriptions.add(sub("sub-weibo", "weibo:user"))

// ── 1. 首次同步:两个平台都写入 ─────────────────────────────────────────────
let fields = await dl.syncBrowserCookies()
assert.deepEqual([...fields].sort(), ["weiboCookie", "xhsCookie"], "两个平台都应更新")
let s = await dl.settings.get()
assert.equal(s.xhsCookie, "a1=a1-1; id_token=id-1; web_session=ws-1", "xhs 快照应按 key 排序")
assert.equal(s.weiboCookie, "SUBP=subp-m; SUB=sub-m; _T_WM=wm".split("; ").sort().join("; "), "weibo 用 m.weibo.cn 的 cookie")
assert.equal(xhsReads, 1, "同一 cookie 字段只读一次(xhs 两个渠道去重)")
assert.equal(weiboMobileReads, 1, "weibo 首选 m.weibo.cn")
assert.equal(weiboDesktopReads, 0, "m.weibo.cn 有 SUB 时不应再读 weibo.com")
// provider 快照必须同步:HTTP 回落路径下一跳就用新值。
assert.equal(resolveCookie(undefined, "xhs"), s.xhsCookie, "provider 快照应更新")
assert.equal(resolveCookie(undefined, "weibo"), s.weiboCookie, "provider 快照应更新(weibo)")

// ── 2. 没变化:不重复写 ────────────────────────────────────────────────────
fields = await dl.syncBrowserCookies()
assert.deepEqual(fields, [], "cookie 未变化时不应重写")

// ── 3. 浏览器无登录标记:保留现有快照 ──────────────────────────────────────
fakeXhs = { web_session: "guest" }
fakeWeiboMobile = {}
fakeWeiboDesktop = {}
fields = await dl.syncBrowserCookies()
assert.deepEqual(fields, [], "无登录标记不应写入")
s = await dl.settings.get()
assert.equal(s.xhsCookie, "a1=a1-1; id_token=id-1; web_session=ws-1", "无标记不能清空 xhs 快照")
assert.equal(resolveCookie(undefined, "weibo"), "SUBP=subp-m; SUB=sub-m; _T_WM=wm".split("; ").sort().join("; "), "无标记不能清空 weibo 快照")

// ── 4. 读浏览器期间用户手改同字段 → compare-and-set 放弃 ──────────────────
fakeXhs = { id_token: "id-2", a1: "a1-2" }
fakeWeiboMobile = { SUB: "sub-new", SUBP: "subp-new" }
beforeWeiboRead = async () => {
  await dl.settings.set({ weiboCookie: "manual=1" })
}
fields = await dl.syncBrowserCookies()
assert.deepEqual(fields, ["xhsCookie"], "weibo 字段被手改 → 本次跳过;xhs 照常更新")
s = await dl.settings.get()
assert.equal(s.xhsCookie, "a1=a1-2; id_token=id-2", "xhs 应更新到新快照")
assert.equal(s.weiboCookie, "manual=1", "手改值不能被浏览器旧快照覆盖")

// ── 5. weibo 回落:只有 weibo.com 有 SUB ─────────────────────────────────
await dl.settings.set({ weiboCookie: "" })
fakeWeiboMobile = {}
fakeWeiboDesktop = { SUB: "sub-d", ALF: "alf" }
fields = await dl.syncBrowserCookies()
assert.ok(fields.includes("weiboCookie"), "只有 weibo.com 登录态时也应同步")
s = await dl.settings.get()
assert.equal(s.weiboCookie, "ALF=alf; SUB=sub-d", "回落到 weibo.com 的 cookie 集")

// ── 6. 没有订阅 → 不读浏览器 ─────────────────────────────────────────────
await dl.subscriptions.remove("sub-xhs")
await dl.subscriptions.remove("sub-weibo")
fakeXhs = { id_token: "id-3" }
fakeWeiboMobile = { SUB: "sub-3" }
let xhsBefore = xhsReads
let weiboBefore = weiboMobileReads
fields = await dl.syncBrowserCookies()
assert.deepEqual(fields, [], "无订阅不应同步")
assert.equal(xhsReads, xhsBefore, "无订阅不应读 xhs cookie")
assert.equal(weiboMobileReads, weiboBefore, "无订阅不应读 weibo cookie")

// ── 7. 只有停用订阅 → 不读浏览器(停用订阅本轮没有消费方) ─────────────────
await dl.subscriptions.add({ ...sub("sub-weibo-off", "weibo:user"), enabled: false })
fakeWeiboMobile = { SUB: "sub-4" }
weiboBefore = weiboMobileReads
fields = await dl.syncBrowserCookies()
assert.deepEqual(fields, [], "停用订阅不应同步")
assert.equal(weiboMobileReads, weiboBefore, "停用订阅不应读 weibo cookie")
await dl.subscriptions.remove("sub-weibo-off")

// ── 8. 只有 xhs 订阅:桌面无 HTTP 消费方,不单独拉起浏览器 ────────────────
await dl.subscriptions.add(sub("sub-xhs-2", "xhs:user"))
fakeXhs = { id_token: "id-4", a1: "a1-4" }
xhsBefore = xhsReads
fields = await dl.syncBrowserCookies()
assert.deepEqual(fields, [], "xhs 无桌面消费方,不应为它单独启动浏览器")
assert.equal(xhsReads, xhsBefore, "仅 xhs 订阅不应读 cookie")

// weibo 订阅在场时,xhs 顺带同步(浏览器已为 weibo 拉起,近零成本)。
await dl.subscriptions.add(sub("sub-weibo-2", "weibo:user"))
fields = await dl.syncBrowserCookies()
assert.deepEqual([...fields].sort(), ["weiboCookie", "xhsCookie"], "浏览器已拉起时 xhs 应顺带同步")
s = await dl.settings.get()
assert.equal(s.xhsCookie, "a1=a1-4; id_token=id-4", "xhs 快照应更新到顺带读取的值")

console.log("cookie-sync.check: 全部通过")
