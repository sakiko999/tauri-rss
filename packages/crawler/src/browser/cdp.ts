/**
 * browser/cdp — 浏览器模拟抓取的 CDP 薄层。
 *
 * 微博/小红书反爬强,需真实浏览器提供登录态 + JS 签名(_webmsxyw)+ 设备指纹。
 * 生产宿主是 `appHost.browser`(Tauri spawn 系统 Edge + CDP,见 packages/host
 * tauri/browser-backend.ts);本模块在其 `evaluate` 之上封装页面级操作:
 *   - cdpFetch:      页面上下文 fetch(自动带 Edge profile 登录态 cookie),返回
 *                     { status, bodyText }(形状对齐 host.ts 的 httpGet);
 *   - cdpEnsurePage:  导航到目标站点并等待就绪(xhs 需先加载页面才有 _webmsxyw)。
 *
 * 不直接引用 appHost.browser 类型——经参数传入,channel 侧检测门面存在才调用。
 */

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

/** 导航到 URL 并等待 document.readyState==='complete'(xhs 签名脚本随页面加载)。 */
export async function cdpNavigate(browser: BrowserBackend, url: string): Promise<void> {
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
 * 轮询页面条件直到为 true 或超时。xhs 场景用于等 `window._webmsxyw` 出现。
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
