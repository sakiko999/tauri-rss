/**
 * xhs 策略层自检(假 BrowserBackend,不连真实 Edge)。
 *
 * 保护的是最容易静默漂移的矩阵:登录页优先 / 匿名 / 被动 passiveOnly / 登录重定向。
 * 错误形态都是「静默 0 条」或「读错页面 state」,不会抛错,所以留断言。
 */
import {
  ensureXhsPath,
  fetchXhsList,
  flatXhsStateList,
  resolveXhsRoute,
} from "../channels/xhs/shared.ts"

let failed = 0
const ok = (cond: boolean, msg: string): void => {
  if (!cond) {
    failed += 1
    console.error(`✘ ${msg}`)
  }
}

const XHS = "https://www.xiaohongshu.com"

interface FakeState {
  origin?: string
  path?: string
  pageLoggedIn?: boolean | null
  domLoggedIn?: boolean
  cookies?: Record<string, string>
  verifyBox?: boolean
  fetchBody?: string
  /** 模拟服务端把目标页 302 到 /login。 */
  redirectToLogin?: boolean
}

/**
 * 假浏览器:按页面表达式返回状态。
 *
 * 只实现 cdpNavigate / waitUntil / 登录判据 / cdpFetch 需要的几种表达式;
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
    verifyBox: input.verifyBox ?? false,
    fetchBody: input.fetchBody ?? "<html>anon</html>",
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
    if (expression.includes("fe-verify-box")) return st.verifyBox
    if (expression.includes('a[href*="/user/profile/"]')) return st.domLoggedIn
    if (expression.includes("loggedIn")) return st.pageLoggedIn
    // cdpFetch 的页面内 fetch 表达式。
    if (expression.includes("fetch(a.url")) return { status: 200, bodyText: st.fetchBody }
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

// ── 路由矩阵 ─────────────────────────────────────────────────────────────────
{
  const { browser } = fakeBrowser(base({ path: "/login", pageLoggedIn: false }))
  ok((await resolveXhsRoute(browser)) === "login-page", "登录页应优先判 login-page(即使有残留 cookie)")
}
{
  const { browser } = fakeBrowser(base({ pageLoggedIn: true }))
  ok((await resolveXhsRoute(browser)) === "logged-in", "页面 loggedIn=true 应判 logged-in")
}
{
  const { browser } = fakeBrowser(base({ pageLoggedIn: false }))
  ok((await resolveXhsRoute(browser)) === "anonymous", "无登录证据应判 anonymous")
}
{
  const { browser } = fakeBrowser(base({ pageLoggedIn: null, cookies: { user_id: "u1" } }))
  ok((await resolveXhsRoute(browser)) === "logged-in", "页面判据缺失时应回退 user_id cookie")
}

// ── fetchXhsList:登录页策略 ────────────────────────────────────────────────
{
  const { browser } = fakeBrowser(base({ redirectToLogin: true }))
  let msg = ""
  try {
    await fetchXhsList<string>(
      browser,
      {
        url: `${XHS}/explore`,
        readPage: async () => "ssr-on-login-page",
        loginError: "LOGIN_REQUIRED",
      },
      "list:test",
    )
  } catch (e) {
    msg = String(e)
  }
  ok(msg.includes("LOGIN_REQUIRED"), "无 parseHtml 的 explore 在登录页应抛可操作错误,不能静默读空 SSR")
}
{
  const { browser } = fakeBrowser(base({ redirectToLogin: true, fetchBody: "<html>full</html>" }))
  let html = ""
  const got = await fetchXhsList<string>(
    browser,
    {
      url: `${XHS}/user/profile/u1`,
      readPage: async () => "ssr-on-login-page",
      parseHtml: (h) => {
        html = h
        return "anonymous-html"
      },
      loginError: "LOGIN_REQUIRED",
    },
    "list:test",
  )
  ok(got === "anonymous-html" && html === "<html>full</html>", "有 parseHtml 的渠道在登录页应走匿名 fetch")
}

// ── fetchXhsList:匿名 / 被动 / 登录态 ───────────────────────────────────────
{
  const { browser } = fakeBrowser(base())
  const got = await fetchXhsList<string>(
    browser,
    {
      url: `${XHS}/explore`,
      readPage: async () => "anonymous-ssr",
      loginError: "LOGIN_REQUIRED",
    },
    "list:test",
  )
  ok(got === "anonymous-ssr", "explore 匿名应读页面 SSR")
}
{
  const { browser } = fakeBrowser(base())
  const got = await fetchXhsList<string>(
    browser,
    {
      url: `${XHS}/user/profile/u1`,
      readPage: async () => "should-not-fetch",
      parseHtml: () => "should-not-parse",
      passiveOnly: true,
    },
    "list:test",
  )
  ok(got === null, "被动 + 匿名应返回 null(交给 core 回退缓存)")
}
{
  const { browser } = fakeBrowser(base({ pageLoggedIn: true }))
  const got = await fetchXhsList<string>(
    browser,
    {
      url: `${XHS}/user/profile/u1`,
      readPage: async () => "logged-in-ssr",
      parseHtml: () => "should-not-parse",
      passiveOnly: true,
    },
    "list:test",
  )
  ok(got === "logged-in-ssr", "被动 + 登录态仍允许读页面 SSR")
}

// ── ensureXhsPath:同址只比 pathname,但必须同 origin ────────────────────────
{
  const { browser, navs } = fakeBrowser(base({ path: "/explore" }))
  await ensureXhsPath(browser, "/explore")
  ok(navs.length === 0, "同 origin + 同 path(忽略 query)不应整页重载")
}
{
  const { browser, navs } = fakeBrowser(base({ path: "/explore" }))
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
console.log("✔ xhs 策略层自检通过(路由矩阵 / 登录页策略 / 被动 / origin 校验)")
