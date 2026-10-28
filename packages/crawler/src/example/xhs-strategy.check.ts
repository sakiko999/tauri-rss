/**
 * xhs 策略层自检(假 BrowserBackend,不连真实浏览器)。
 *
 * 保护的是最容易静默漂移的矩阵:**登录闸门**(登录页优先 / 未登录 / 有效登录)与
 * **HTTP 路径的 cookie 闸门**。错误形态都是「静默 0 条」或「读错页面 state」,
 * 不会抛错,所以留断言。
 *
 * 2026-10-22 起 xhs 匿名态已移除:所有列表/详情都必须登录,自检也按这个矩阵。
 */
import { setPlatformCookieLookup } from "@amoeba/resolve"

import {
  assertXhsLoggedIn,
  ensureXhsPath,
  fetchXhsList,
  flatXhsStateList,
  requireXhsCookie,
} from "../channels/xhs/shared.ts"

let failed = 0
const ok = (cond: boolean, msg: string): void => {
  if (!cond) {
    failed += 1
    console.error(`✘ ${msg}`)
  }
}

const errMsg = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p
    return ""
  } catch (e) {
    return String(e)
  }
}

const XHS = "https://www.xiaohongshu.com"

interface FakeState {
  origin?: string
  path?: string
  pageLoggedIn?: boolean | null
  domLoggedIn?: boolean
  cookies?: Record<string, string>
  /** 模拟服务端把目标页 302 到 /login。 */
  redirectToLogin?: boolean
}

/**
 * 假浏览器:按页面表达式返回状态。
 *
 * 只实现 cdpNavigate / waitUntil / 登录判据需要的几种表达式;
 * 新增策略分支时在这里补对应模式,别让自检悄悄变成空转。
 */
function fakeBrowser(input: FakeState = {}): {
  browser: BrowserBackend
  navs: string[]
} {
  const st = {
    origin: input.origin ?? XHS,
    path: input.path ?? "/explore",
    pageLoggedIn: input.pageLoggedIn ?? null,
    domLoggedIn: input.domLoggedIn ?? false,
    cookies: input.cookies ?? {},
    redirectToLogin: input.redirectToLogin ?? false,
  }
  const navs: string[] = []

  const evaluate = async (expression: string): Promise<unknown> => {
    // readXhsStateList / Count 的表达式(先于 __INITIAL_STATE__ 就绪判断匹配)。
    if (expression.includes("const path =")) return []
    // cdpNavigate 的赋值(注意 `location.href ===` 含 `location.href =`,`= ` 才能区分)。
    if (expression.includes("location.href = ")) {
      const m = expression.match(/location\.href = "([^"]+)"/)
      if (m) {
        const url = new URL(m[1]!)
        navs.push(url.href)
        st.origin = url.origin
        st.path = st.redirectToLogin ? "/login" : url.pathname
      }
      return true
    }
    if (expression.includes("performance.timeOrigin")) return 1
    if (expression.includes("document.readyState")) return true
    if (expression.includes("typeof window.__INITIAL_STATE__")) return true
    // isXhsLoginPage:origin + pathname 的组合判据。
    if (expression.includes("location.pathname.startsWith('/login')")) {
      return st.origin === XHS && st.path.startsWith("/login")
    }
    if (expression.includes("location.origin ===")) return st.origin === XHS
    if (expression.includes("location.pathname")) return st.path
    if (expression.includes("location.origin")) return st.origin
    if (expression.includes("fe-verify-box")) return false
    if (expression.includes('a[href*="/user/profile/"]')) return st.domLoggedIn
    if (expression.includes("loggedIn")) return st.pageLoggedIn
    return undefined
  }

  const browser = {
    evaluate,
    getCookies: async () => st.cookies,
    close: async () => {},
  } as unknown as BrowserBackend
  return { browser, navs }
}

const base = (extra: FakeState = {}): FakeState => ({
  origin: XHS,
  path: "/explore",
  pageLoggedIn: false,
  cookies: {},
  ...extra,
})

// ── 纯函数:state 解包(页面 state 与 HTML state 必须同规则) ──────────────────
const feedState = {
  feed: { _rawValue: { feeds: { _rawValue: [{ id: "a" }, { id: "b" }] } } },
}
ok(flatXhsStateList(feedState, ["feed", "feeds"]).length === 2, "feed.feeds 应解 _rawValue 并 flat")
ok(flatXhsStateList({ user: { notes: [{ id: "n1" }] } }, ["user", "notes"]).length === 1, "user.notes 应扁平化")
ok(flatXhsStateList(undefined, ["user", "notes"]).length === 0, "缺失 state 应返回空数组")

// ── 登录闸门:登录页优先 / 未登录 / 有效登录 ──────────────────────────────────
{
  const { browser } = fakeBrowser(base({ path: "/login", pageLoggedIn: false }))
  ok((await errMsg(assertXhsLoggedIn(browser))).includes("需要登录"), "登录页应判未登录(即使有残留 cookie)")
}
{
  // 失效会话的残留登录位:页面 loggedIn 仍是 true,但已被重定向到登录页。
  // 这条用来钉住「登录页优先于登录位」——把两个判断对调时此断言必须失败。
  const { browser } = fakeBrowser(base({ path: "/login", pageLoggedIn: true }))
  ok(
    (await errMsg(assertXhsLoggedIn(browser))).includes("需要登录"),
    "登录页必须优先于残留 loggedIn=true(否则会把登录页空 SSR 当正常数据)",
  )
}
{
  // 失效会话:URL 还在内容页,页面登录位却是 false。
  const { browser } = fakeBrowser(base({ pageLoggedIn: false, cookies: { web_session: "guest" } }))
  ok((await errMsg(assertXhsLoggedIn(browser))).includes("需要登录"), "无登录证据应判未登录(web_session 不算登录)")
}
{
  const { browser } = fakeBrowser(base({ pageLoggedIn: true }))
  ok((await errMsg(assertXhsLoggedIn(browser))) === "", "页面 loggedIn=true 应通过")
}
{
  const { browser } = fakeBrowser(base({ pageLoggedIn: null, cookies: { user_id: "u1" } }))
  ok((await errMsg(assertXhsLoggedIn(browser))) === "", "页面判据缺失时应回退 user_id cookie")
}

// ── fetchXhsList:未登录一律抛可操作错误,绝不读匿名 SSR ───────────────────────
{
  const { browser } = fakeBrowser(base({ redirectToLogin: true }))
  let called = false
  const msg = await errMsg(
    fetchXhsList<string>(
      browser,
      {
        url: `${XHS}/explore`,
        readPage: async () => {
          called = true
          return "ssr-on-login-page"
        },
        loginError: "LOGIN_REQUIRED",
      },
      "list:test",
    ),
  )
  ok(msg.includes("LOGIN_REQUIRED") && !called, "登录重定向应抛错且不得读页面 SSR")
}
{
  const { browser } = fakeBrowser(base())
  let called = false
  const msg = await errMsg(
    fetchXhsList<string>(
      browser,
      {
        url: `${XHS}/user/profile/u1`,
        readPage: async () => {
          called = true
          return "anonymous-ssr"
        },
        loginError: "LOGIN_REQUIRED",
      },
      "list:test",
    ),
  )
  ok(msg.includes("LOGIN_REQUIRED") && !called, "未登录应抛错(匿名态已移除)")
}
{
  const { browser } = fakeBrowser(base({ pageLoggedIn: true }))
  const got = await fetchXhsList<string>(
    browser,
    {
      url: `${XHS}/explore`,
      readPage: async () => "logged-in-ssr",
      loginError: "LOGIN_REQUIRED",
    },
    "list:test",
  )
  ok(got === "logged-in-ssr", "登录态应读页面 SSR")
}

// ── HTTP 路径(cookie 闸门):显式 > 空串(强制匿名 → 报错)> provider ───────────
{
  ok(requireXhsCookie("a=1") === "a=1", "显式 cookie 应原样使用")
  ok((await errMsg(Promise.resolve().then(() => requireXhsCookie("")))).includes("需要登录"), "显式空串应报需要登录")
  ok(
    (await errMsg(Promise.resolve().then(() => requireXhsCookie(undefined)))).includes("需要登录"),
    "无 cookie 且无 provider 应报需要登录",
  )
  setPlatformCookieLookup((p) => (p === "xhs" ? "session=1" : undefined))
  ok(requireXhsCookie(undefined) === "session=1", "provider 有登录态时应使用它")
  ok(
    (await errMsg(Promise.resolve().then(() => requireXhsCookie("")))).includes("需要登录"),
    "显式空串仍应强制匿名 → 报错(不回落 provider)",
  )
  setPlatformCookieLookup(null)
}

// ── ensureXhsPath:同址只比 pathname,但必须同 origin ────────────────────────
{
  const { browser, navs } = fakeBrowser(base({ path: "/explore", pageLoggedIn: true }))
  await ensureXhsPath(browser, "/explore")
  ok(navs.length === 0, "同 origin + 同 path(忽略 query)不应整页重载")
}
{
  const { browser, navs } = fakeBrowser(base({ path: "/explore", pageLoggedIn: true }))
  await ensureXhsPath(browser, "/explore/")
  ok(navs.length === 0, "尾斜杠归一后不应重载")
}
{
  const { browser, navs } = fakeBrowser(base({ origin: "https://evil.example", path: "/explore" }))
  await ensureXhsPath(browser, "/explore")
  ok(
    navs.some((u) => u === `${XHS}/explore`),
    "异 origin 即使 pathname 相同也必须导航到 xhs(否则会读别的页面 state)",
  )
}

if (failed) {
  console.error(`✘ xhs 策略层自检失败 ${failed} 条`)
  process.exit(1)
}
console.log("✔ xhs 策略层自检通过(登录闸门 / 无匿名 / cookie 闸门 / origin 校验)")
