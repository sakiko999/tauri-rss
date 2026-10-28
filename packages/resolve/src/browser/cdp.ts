/**
 * browser/cdp — 浏览器模拟抓取的 CDP 薄层。
 *
 * 微博/小红书反爬强,需真实浏览器提供登录态(抓取浏览器 profile cookie)+ 设备指纹。
 * 生产宿主是 `appHost.browser`(Tauri WebView2 隐藏窗口 + CDP,见 packages/host
 * browser/backend.ts 的通用实现与 tauri/browser-backend.ts 的桌面载具);本模块在其
 * `evaluate` 之上封装页面级操作:
 *   - cdpFetch:  页面上下文 fetch(自动带 profile 登录态 cookie),返回
 *                 { status, bodyText }(形状对齐 host.ts 的 httpGet);
 *   - cdpJson:   页面内 fetch JSON(weibo API);
 *   - cdpNavigate:导航到 URL 并等待就绪(默认同址不重载保留 SPA state;forceReload 强刷)。
 *
 * ⚠️ 单浏览器实例被多平台 channel(weibo/xhs)以 **lane target** 共享(风控 §3.13):
 * 「导航到目标域 + 同域 fetch」必须用 `withBrowserOp` 包成原子单元(同 lane 串行,
 * 列表/详情/登录各有独立 tab),否则并发刷新互相抢页面(页面停在别的域 fetch →
 * 跨域 Failed to fetch / 匿名 406)。宿主缺 `browser.tab` 时各 lane 回落默认页,
 * 语义等同旧全局锁。
 *
 * 不直接引用 appHost.browser 类型——经参数传入,channel 侧检测门面存在才调用。
 */

// ── 浏览器操作调度(lane 化,风控 §3.13/§3.13.1)────────────────────────────────
// 互斥/窗口模式/平台准入/进程级操作四种粒度分别由 scheduler 的四个原语承担;
// 本模块只提供 withBrowserOp 这一个组合入口(顺序:gate → op lane → renderLease)。
import { browserGateFor, withBrowserGlobal, withBrowserOpSlot, withLane, withRenderLease } from "./scheduler.ts"

/** withBrowserOp 的选项。 */
export interface BrowserOpOptions {
  /**
   * lane 名(决定用哪个 tab):`list:<channelKey>`(列表,保住翻页 state)/
   * `detail:<platform>`(详情,不再污染列表页)/ `login:<platform>`(扫码,不阻塞抓取)。
   * 缺省 "default"(单页语义;宿主无 `browser.tab` 时所有 lane 共享默认页)。
   */
  lane?: string
  /** "interactive" = 滚动/懒加载(renderLease + 滚动前 activate);缺省 hidden(无模式动作)。 */
  mode?: BrowserWindowMode
  /** 平台准入(browserGate)。登录流程**不传**(冷却期仍需允许重新扫码)。 */
  platform?: string
}

/**
 * 在指定 lane 上独占执行一次浏览器操作 —— lane 化后的唯一组合入口。
 *
 * 顺序与理由(§3.13.1):
 *   1. **gate 在 op lane 锁外**:平台冷却/间隔的等待不占 op lane(不队头阻塞该 lane
 *      已排队的其它操作);gate 自身在 `gate:<platform>` lane 串行(修 governor
 *      「读 last → sleep → 写 last」的非原子);
 *   2. **op lane 串行**:同 lane 的导航+fetch 原子(拿各自 tab,互不抢页面),
 *      跨 lane 并发(列表/详情/登录各一个 tab);
 *   3. **interactive 用 renderLease**:引用计数防「任一 hidden 收尾掐掉别人的滚动」;
 *      滚动前 `activate` 本 lane 的 tab(非激活 tab 的 rAF/IO 停摆,§3.9 同机制)。
 *
 * fn 收到的 `b` 是本 lane 的操作句柄(BrowserBackend 或 BrowserTab —— 形状兼容):
 * lane 内的 cdpFetch/cdpEvaluate/cdpNavigate 全部打在自己的 tab 上。
 */
export function withBrowserOp<T>(
  browser: BrowserBackend,
  opts: BrowserOpOptions,
  fn: (b: BrowserBackend) => Promise<T>,
): Promise<T> {
  const lane = opts.lane ?? "default"
  // 共享通道:与 withBrowserGlobal(clearCookies/resetProfile)构成读写锁 ——
  // 进程级操作等在途 op 全部退出且阻塞新 op(不同 lane 键并不天然互斥)。
  return browserGateFor(opts.platform).then(() =>
    withBrowserOpSlot(() =>
      withLane(`op:${lane}`, async () => {
        // lane → tab(宿主缺 tab 能力 → 单页语义,回默认 backend)。
        const b: BrowserBackend = browser.tab?.(lane) ?? browser
        if (opts.mode === "interactive") {
          return withRenderLease(browser, async () => {
            // 滚动驱动必须激活本 tab:hidden(非激活)下渲染管线停摆,scrollTo 只改
            // scrollTop、不派发 scroll 事件(§3.9);activate 毫秒级、不触发重载。
            // interactive 操作已被 withRenderLease 全局串行,不会两个 lane 互抢激活。
            await (b as BrowserTab).activate?.()
            return fn(b)
          })
        }
        return fn(b)
      }),
    ),
  )
}

/**
 * ⚠️ **兼容壳**(lane 化前是唯一入口):等价 `withBrowserOp(browser, { lane: "default",
 * mode, platform })`,所有 lane 共享默认 tab。存量调用点逐个迁到 withBrowserOp;
 * 新代码一律用 withBrowserOp。
 */
export function withBrowserMode<T>(
  browser: BrowserBackend,
  mode: BrowserWindowMode,
  fn: () => Promise<T>,
  platform?: string,
): Promise<T> {
  return withBrowserOp(browser, { lane: "default", mode, platform }, () => fn())
}

/**
 * 扫码登录的持锁包装(xhs / weibo / douyin 三平台同构)。
 *
 * 登录跑在**专属 login lane**(`login:<platform>` 的独立 tab):刷新在自己的 lane
 * 上,导航不会再把登录弹窗带走;刷新超时经 `abortTabs({keepLogin:true})` 豁免本 lane
 * —— 旧的 `scanLoginActive` 布尔与 45s 超时的平台前缀猜测一并退役。
 *
 * ⚠️ 刻意**不传 platform**(不过 browserGate):冷却期正是用户需要重新扫码自救的时候。
 * `mode` 由平台自选（xhs/weibo 的二维码是 img data URL，hidden 即可；douyin 是
 * canvas 绘制，hidden 下渲染停摆画不出来，要 interactive）。
 */
export function withScanLoginLock<T>(
  browser: BrowserBackend,
  mode: BrowserWindowMode,
  run: (b: BrowserBackend) => Promise<T>,
  platform: string,
): Promise<T> {
  // ⚠️ 必须把 lane 句柄交给登录流程:早先只加了 login lane 的锁却仍用默认页 —
  // 登录根本没跑在专属 tab 上(douyin interactive 还会把默认页挤成非激活,canvas
  // 二维码渲染停摆),abortTabs({keepLogin}) 豁免的也是个空壳(审查发现)。
  return withBrowserOp(browser, { lane: `login:${platform}`, mode }, (b) => run(b))
}

/**
 * 浏览器进程级操作(clearCookies / resetProfile)的全局锁包装。
 * 与所有 lane 互斥:清 cookie 与导航交错会产生半删状态;resetProfile 会杀掉正在
 * 抓取的 Edge。lane 化前这些调用完全绕过浏览器锁。
 */
export function withBrowserLock<T>(fn: () => Promise<T>): Promise<T> {
  return withBrowserGlobal(fn)
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
        msg.includes("Execution context was destroyed") ||
        msg.includes("Cannot find context") ||
        msg.includes("Cannot find execution context") ||
        msg.includes("most likely because of a navigation")
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
export async function cdpJson<T = unknown>(browser: BrowserBackend, url: string, init?: CdpFetchInit): Promise<T> {
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
