/**
 * browser/cdp — 浏览器模拟抓取的 CDP 薄层。
 *
 * 微博/小红书反爬强,需真实浏览器提供登录态(Edge profile cookie)+ 设备指纹。
 * 生产宿主是 `appHost.browser`(Tauri spawn 系统 Edge + CDP,见 packages/host
 * tauri/browser-backend.ts);本模块在其 `evaluate` 之上封装页面级操作:
 *   - cdpFetch:  页面上下文 fetch(自动带 Edge profile 登录态 cookie),返回
 *                 { status, bodyText }(形状对齐 host.ts 的 httpGet);
 *   - cdpJson:   页面内 fetch JSON(weibo API);
 *   - cdpNavigate:导航到 URL 并等待就绪(默认同址不重载保留 SPA state;forceReload 强刷)。
 *
 * ⚠️ 单 Edge 实例单 page target 被多平台 channel(weibo/xhs)共享——「导航到目标域 +
 * 同域 fetch」必须用 withBrowserMode 包成原子单元（内部走 withBrowserLock）,
 * 否则并发刷新互相抢页面(页面停在别的域 fetch → 跨域 Failed to fetch / 匿名 406)。
 *
 * 不直接引用 appHost.browser 类型——经参数传入,channel 侧检测门面存在才调用。
 */

// ── 浏览器操作互斥 ──────────────────────────────────────────────────────────────
// 全局 promise 链:任何浏览器模拟操作(导航+同域抓取)串行执行,互不交错。
let browserLock: Promise<void> = Promise.resolve()
/**
 * 串行执行浏览器操作:持锁直到 fn 完成,期间其他浏览器操作排队。
 * ⚠️ 一般**不直接用**：用 `withBrowserMode` 一并处理窗口模式与释放。
 */
function withBrowserLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = browserLock
  let release!: () => void
  browserLock = new Promise<void>((r) => (release = r))
  return prev.then(() => fn()).finally(release)
}

/**
 * 尽力切到某窗口模式：失败不影响数据路径。
 * `hidden` 是默认态，切不过去（窗口未就绪等）也不该让抓取失败。
 */
async function setBrowserModeQuiet(
  browser: BrowserBackend,
  mode: BrowserWindowMode,
): Promise<void> {
  try {
    await browser.setMode?.(mode)
  } catch {
    // 静默降级：SSR/页面 fetch 在 interactive 下同样能跑，只是多渲染开销。
  }
}

/**
 * 在指定窗口模式下**独占**浏览器执行操作（内部串行化，等价于旧的
 * `withBrowserLock(async () => { setMode(...); ... })`）。
 *
 * - `hidden`：SSR/DOM 读取、页面内 fetch；模式切不过去也不影响数据路径。
 * - `interactive`：滚动/懒加载页面；切不过去会抛错（否则滚动会静默 0 条），
 *   结束后自动切回 `hidden`（interactive 是真实渲染，常驻有 CPU/GPU 开销）。
 *
 * `platform` 传入时先过宿主的 `net.browserGate`（平台冷却 + 最小间隔 + 随机抖动）。
 * ⚠️ CDP 流量不经过 `appHost.http`，不过闸的话 governor 的配额/冷却对真实账号
 * 的主路径完全不生效。**登录流程不要传 platform**（冷却期仍需允许重新扫码）。
 */
export function withBrowserMode<T>(
  browser: BrowserBackend,
  mode: BrowserWindowMode,
  fn: () => Promise<T>,
  platform?: string,
): Promise<T> {
  return withBrowserLock(async () => {
    if (platform) await globalThis.appHost?.net?.browserGate?.(platform)
    if (mode === "interactive") {
      await browser.setMode?.("interactive")
      try {
        return await fn()
      } finally {
        await setBrowserModeQuiet(browser, "hidden")
      }
    }
    await setBrowserModeQuiet(browser, mode)
    return fn()
  })
}

/**
 * 扫码登录的持锁包装(xhs / weibo / douyin 三平台同构)。
 *
 * 登录与抓取共享同一个 page target，必须持浏览器锁：否则刷新会把登录弹窗导航走，
 * 手机确认后页面自身的轮询已停止，登录永远等不到凭证。登录可能持锁数分钟（等用户
 * 扫码），期间排队中的刷新会先撞上 45s 超时，那个超时原本会 abortPending 掐断共享
 * 连接 —— `scanLoginActive` 让超时方跳过中止。
 *
 * ⚠️ 刻意**不传 platform**：冷却期正是用户需要重新扫码自救的时候，不能被 browserGate
 * 拦住；登录仍然走锁串行。`mode` 由平台自选（xhs/weibo 的二维码是 img data URL，
 * hidden 即可；douyin 是 canvas 绘制，hidden 下渲染停摆画不出来，要 interactive）。
 */
export function withScanLoginLock<T>(
  browser: BrowserBackend,
  mode: BrowserWindowMode,
  run: () => Promise<T>,
): Promise<T> {
  return withBrowserMode(browser, mode, async () => {
    // 只在真正持锁时置位：排队中的登录不能提前把标记打开，否则前一个登录结束时
    // 会把标记清掉、让刷新超时误杀后一个登录。
    browser.scanLoginActive = true
    try {
      return await run()
    } finally {
      browser.scanLoginActive = false
    }
  })
}

/** 页面内 fetch 的入参(JSON 序列化传进 expression)。 */
export interface CdpFetchInit {
  method?: string
  headers?: Record<string, string>
  body?: string
  /** Referer(weibo m.weibo.cn API 要求;并入 headers)。 */
  referer?: string
  /**
   * fetch credentials(默认 `include` = 带浏览器 profile 的 cookie)。
   * ⚠️ 小红书 profile 页要 **`omit`**:实测带 cookie 反而拿 47KB 空壳(0 cards),
   * 匿名才给 253KB 完整 SSR(31 cards)——见 xhs/user.ts。其他平台别乱改。
   */
  credentials?: "omit" | "same-origin" | "include"
}

/** 导航过渡期 evaluate 报错(context destroyed)视为瞬态,重试。 */
async function evalWithNavRetry<T>(
  browser: BrowserBackend,
  expression: string,
  opts: { awaitPromise?: boolean; returnByValue?: boolean },
  retries = 5,
): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await browser.evaluate<T>(expression, opts)
    } catch (e) {
      const msg = String(e)
      const navTransient =
        msg.includes("Execution context was destroyed") || msg.includes("Cannot find context") ||
        msg.includes("Cannot find execution context") || msg.includes("most likely because of a navigation")
      if (!navTransient || i >= retries) throw e
      await new Promise((r) => setTimeout(r, 300))
    }
  }
}

/** 页面内执行 fetch,返回状态 + 文本。cookie 由浏览器 profile 自动携带。 */
export async function cdpFetch(
  browser: BrowserBackend,
  url: string,
  init?: CdpFetchInit,
): Promise<{ status: number; bodyText: string }> {
  const headers = { ...(init?.headers ?? {}), ...(init?.referer ? { Referer: init.referer } : {}) }
  const args = JSON.stringify({
    url,
    method: init?.method ?? "GET",
    headers,
    body: init?.body,
    credentials: init?.credentials ?? "include",
  })
  // 浏览器内 fetch:自带登录态 cookie + 环境指纹;手动 Cookie header 会被浏览器 forbid,
  // 故不传 cookie(凭据由 credentials 控制,默认 include = profile 登录态,扫码一次持久化)。
  const expression = `(async () => {
    const a = ${args};
    const res = await fetch(a.url, { method: a.method, headers: a.headers, body: a.body || undefined, credentials: a.credentials });
    return { status: res.status, bodyText: await res.text() };
  })()`
  return evalWithNavRetry<{ status: number; bodyText: string }>(browser, expression, {
    awaitPromise: true,
    returnByValue: true,
  })
}

/**
 * 页面内的生产求值统一入口(默认 awaitPromise + returnByValue)。
 *
 * ⚠️ 这里**不做导航重试**——click / scroll 这类有副作用的表达式不能自动重放。
 * 需要吞掉导航过渡期 `Execution context was destroyed` 的**读取**,用 cdpFetch
 * (内部 evalWithNavRetry) 或 waitUntil;不要给 cdpEvaluate 默认加重试。
 *
 * ⚠️ expression 在**页面里**执行,必须是纯 JS —— 不能写 TS 类型标注或 `as` 断言
 * (`(n as HTMLElement).offsetParent` 在 tsc 下不报错,运行时才炸成
 * `SyntaxError: Unexpected identifier 'as'`)。
 */
export async function cdpEvaluate<T = unknown>(browser: BrowserBackend, expression: string): Promise<T> {
  return browser.evaluate<T>(expression, { awaitPromise: true, returnByValue: true })
}

/** cdpFetch + 2xx 校验 + JSON.parse(对齐 host.ts httpJson:空 body 返回 null)。 */
export async function cdpJson<T = unknown>(
  browser: BrowserBackend,
  url: string,
  init?: CdpFetchInit,
): Promise<T> {
  const res = await cdpFetch(browser, url, init)
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}: ${url.slice(0, 80)}`)
  const text = res.bodyText
  if (text.trim() === "") return null as unknown as T
  return JSON.parse(text) as T
}

/**
 * 导航到 URL 并等待 document.readyState==='complete'。
 * ⚠️ 默认同址不重载:location.href 赋值即使 URL 相同也会整页导航(SPA 的 Vue state 全丢、
 * 滚动位置归零)。fetchMore 等场景需保留页面 state(已加载内容/滚动进度),同址直接跳过。
 * forceReload=true(refresh 用)跳过同址检查——refresh 恰恰需要整页重载拿最新 SSR,
 * 页面停在 profile URL 时 location.href 同 URL 赋值也整页导航,满足刷新语义。
 */
export async function cdpNavigate(browser: BrowserBackend, url: string, forceReload = false): Promise<void> {
  if (!forceReload) {
    let same = false
    try {
      same = await browser.evaluate<boolean>(`location.href === ${JSON.stringify(url)}`)
    } catch {
      // 导航过渡/context destroyed 时读 href 抛错——视为不同址,走正常导航。
    }
    if (same) return
  }
  // ⚠️ 先记旧文档的 `performance.timeOrigin`。只用 `readyState === 'complete'` 判就绪
  // 会踩一个静默竞态：赋值 `location.href` 后导航是异步提交的，此刻**旧文档本来就是
  // complete**，首个轮询立即通过；紧接着的 `waitUntil(__INITIAL_STATE__)` 也会被旧
  // xhs 页面满足 —— 于是两个 xhs:user 订阅交替刷新时，B 会读到 A 的笔记并写入缓存。
  // timeOrigin 在新文档提交后才会变，用它区分「旧文档」与「新文档」。
  let beforeOrigin: number | undefined
  try {
    beforeOrigin = await browser.evaluate<number>(`performance.timeOrigin`, { returnByValue: true })
  } catch {
    // 读不到(处于导航过渡等) → 退回旧判据,不阻塞导航。
  }
  try {
    await browser.evaluate(`location.href = ${JSON.stringify(url)}; true`, {
      awaitPromise: false,
      returnByValue: true,
    })
  } catch {
    // 导航瞬间旧 execution context 销毁,evaluate 可能抛错——属正常,忽略。
  }
  const ready =
    typeof beforeOrigin === "number" && Number.isFinite(beforeOrigin)
      ? `performance.timeOrigin !== ${beforeOrigin} && document.readyState === 'complete'`
      : `document.readyState === 'complete'`
  await waitUntil(browser, ready, 20_000, `页面未加载完成: ${url}`)
}

/**
 * 轮询页面条件直到为 true 或超时。xhs 场景用于等 `window.__INITIAL_STATE__` 挂载。
 * ⚠️ 导航后 evaluate 可能在旧 execution context 抛错(Execution context was
 * destroyed)——waitUntil 内部把 evaluate 报错视为「未就绪」重试,不冒泡。
 */
export async function waitUntil(
  browser: BrowserBackend,
  conditionExpr: string,
  timeoutMs: number,
  timeoutMsg: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  const expr = `(async () => {
    try { return ${conditionExpr} === true; } catch { return false; }
  })()`
  for (;;) {
    try {
      const ok = await browser.evaluate<boolean>(expr, { awaitPromise: true, returnByValue: true })
      if (ok) return
    } catch {
      // 导航过渡期 context destroyed:重试。
    }
    if (Date.now() > deadline) throw new Error(timeoutMsg)
    await new Promise((r) => setTimeout(r, 250))
  }
}
