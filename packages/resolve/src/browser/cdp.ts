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
 * 同域 fetch」必须用 withBrowserLock 包成原子单元,否则并发刷新互相抢页面
 * (页面停在别的域 fetch → 跨域 Failed to fetch / 匿名 406)。
 *
 * 不直接引用 appHost.browser 类型——经参数传入,channel 侧检测门面存在才调用。
 */

// ── 浏览器操作互斥 ──────────────────────────────────────────────────────────────
// 全局 promise 链:任何浏览器模拟操作(导航+同域抓取)串行执行,互不交错。
let browserLock: Promise<void> = Promise.resolve()
/** 串行执行浏览器操作:持锁直到 fn 完成,期间其他浏览器操作排队。 */
export function withBrowserLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = browserLock
  let release!: () => void
  browserLock = new Promise<void>((r) => (release = r))
  return prev.then(() => fn()).finally(release)
}

/** 页面内 fetch 的入参(JSON 序列化传进 expression)。 */
export interface CdpFetchInit {
  method?: string
  headers?: Record<string, string>
  body?: string
  /** Referer(weibo m.weibo.cn API 要求;并入 headers)。 */
  referer?: string
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
  const args = JSON.stringify({ url, method: init?.method ?? "GET", headers, body: init?.body })
  // 浏览器内 fetch:自带登录态 cookie + 环境指纹;手动 Cookie header 会被浏览器 forbid,
  // 故不传 cookie(依赖 Edge profile 登录态,扫码一次持久化)。
  const expression = `(async () => {
    const a = ${args};
    const res = await fetch(a.url, { method: a.method, headers: a.headers, body: a.body || undefined });
    return { status: res.status, bodyText: await res.text() };
  })()`
  return evalWithNavRetry<{ status: number; bodyText: string }>(browser, expression, {
    awaitPromise: true,
    returnByValue: true,
  })
}

/** 页面内执行任意表达式(调试/取页面状态)。 */
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
  try {
    await browser.evaluate(`location.href = ${JSON.stringify(url)}; true`, {
      awaitPromise: false,
      returnByValue: true,
    })
  } catch {
    // 导航瞬间旧 execution context 销毁,evaluate 可能抛错——属正常,忽略。
  }
  await waitUntil(browser, `document.readyState === 'complete'`, 20_000, `页面未加载完成: ${url}`)
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
