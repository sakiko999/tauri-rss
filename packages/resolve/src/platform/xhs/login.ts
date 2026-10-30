/**
 * xhs 扫码登录 —— 浏览器路径(CDP 附加真实 Edge)。
 *
 * 导航到小红书首页 → 点「登录」触发登录弹窗 → 读 `img.qrcode-img` 的 base64
 * data URL → emitQr 推给 UI → 用户手机扫码 → Edge 页面自身轮询 qrcode/status
 * (浏览器签名真实)确认登录 → 页面 `user.loggedIn` 翻转 / 出现 `user_id` cookie 即成功。
 *
 * ⚠️ **不要用 `web_session` 判断登录**:小红书对匿名访客也会立即签发 web_session
 * (游客会话)。按它判断会「还没扫码就显示已登录」,并把游客 cookie 当成账号凭证存库。
 *
 * 全部走 Runtime.evaluate(读 DOM / cookie),**零 CDP 网络拦截**——二维码是
 * 页面已渲染的 data URL(非截屏),登录态检测是页面 loggedIn + CDP cookie 轮询。
 */

import { cdpEvaluate, cdpNavigate, waitUntil, withScanLoginLock } from "../../browser/cdp.ts"
import type { LoginResult } from "../../index.ts"
import { log } from "../../log.ts"
import { XHS_BASE, xhsDomLoggedIn, xhsPageLoggedIn } from "./client.ts"

export interface XhsScanLoginOptions {
  /** 总超时(默认 5 分钟;xhs 二维码约 4 分钟有效,留余量)。 */
  timeoutMs?: number
  /** UI 关闭弹窗时 abort(登录持全局浏览器锁,必须可取消)。 */
  signal?: AbortSignal
}

/** Record → "k=v; k2=v2" cookie 串(含 HttpOnly,供 HTTP 降级路径用)。 */
function serializeCookies(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ")
}

/**
 * 读二维码 data URL 与**它是否已过期**。img.qrcode-img 为主,canvas.qrcode 兜底。
 *
 * ⚠️ 过期码必须单独识别:login lane 的 tab 跨扫码复用,上次登录留下的弹窗会停在
 * 「二维码已过期 点击刷新」——直接把那张图推给 UI,用户扫了手机端立刻提示失效,
 * 现象就是「重新扫码没有覆盖旧登录」(2026-10-30 实测)。
 */
async function readQr(browser: BrowserBackend): Promise<{ src: string | null; expired: boolean }> {
  const raw = await cdpEvaluate<string | null>(
    browser,
    `(() => {
      const img = document.querySelector('img.qrcode-img');
      let src = img && img.src ? img.src : '';
      if (!src) {
        const cv = document.querySelector('canvas.qrcode');
        if (cv) { try { src = cv.toDataURL('image/png'); } catch { src = ''; } }
      }
      const expired = /二维码已过期|点击刷新/.test(document.body ? document.body.innerText || '' : '');
      return JSON.stringify({ src, expired });
    })()`,
  )
  try {
    const o = JSON.parse(raw ?? "")
    return { src: typeof o.src === "string" && o.src ? o.src : null, expired: o.expired === true }
  } catch {
    return { src: null, expired: false }
  }
}

/**
 * 读登录态(权威判据;页面判据与抓取侧共用 client 的 `xhsPageLoggedIn`/`xhsDomLoggedIn`)。
 *
 * ⚠️ `web_session` **不是登录标志**:匿名访客首次打开页面就会拿到一个游客
 * `web_session`(外加 a1/webId/sec_poison_id 等)。真正的登录标志:
 *   1. 页面 SSR `user.loggedIn === true` / 侧栏「我」入口;
 *   2. 轮询时:`user_id` cookie **相对基线发生变化**(残留旧值不算 —— 服务端 session
 *      失效时旧 cookie 还在,信它会把过期凭证当登录成功,用户永远出不了码)。
 * 初始检测(`preferPageState`)只用页面证据,cookie 完全不参与(宁可白出一次码)。
 */
async function loginState(
  browser: BrowserBackend,
  opts?: {
    /** 初始检测:cookie 不作判据(只信页面),防残留 user_id 误报已登录。 */
    preferPageState?: boolean
    /** 轮询基线:进入扫码前的 user_id;不变视为未登录。 */
    baselineUserId?: string
  },
): Promise<{ loggedIn: boolean; cookies: Record<string, string>; userId?: string }> {
  const cookies = await browser.getCookies(XHS_BASE)
  const pageLoggedIn = await xhsPageLoggedIn(browser)
  // 页面已明确给出登录位时,DOM 探测是多余的 evaluate。
  const domLoggedIn = pageLoggedIn === null ? await xhsDomLoggedIn(browser) : false
  const userId = cookies["user_id"]
  // 轮询时(非 preferPageState)user_id 相对基线变化即算登录 —— **不看 pageLoggedIn**:
  // 扫码后页面可能停留在「未登录」渲染(user.loggedIn 滞后甚至为 false),先按它
  // 短路会把真登录当成未登录,轮询永远等不到翻转。
  const loggedIn =
    pageLoggedIn === true ||
    domLoggedIn ||
    (!opts?.preferPageState && !!userId && userId !== (opts?.baselineUserId ?? ""))
  return { loggedIn, cookies, userId }
}

/** 点「登录」按钮(首页顶部),触发登录弹窗。返回是否点到。 */
async function clickLoginButton(browser: BrowserBackend): Promise<boolean> {
  return cdpEvaluate<boolean>(
    browser,
    `(() => {
      const el = [...document.querySelectorAll('button, a')].find(
        (n) => n.textContent && n.textContent.trim() === '登录' && n.offsetParent !== null
      );
      if (!el) return false;
      el.click();
      return true;
    })()`,
  )
}

/**
 * 轮询二维码出现(点按钮后登录弹窗 JS 渲染),**只接受没过期的码**。
 *
 * 上限 `maxWaitMs`(默认 30s)而不是整个登录超时:二维码一直出不来 = 弹窗没打开,
 * 等满 5 分钟只会让 UI 停在「正在准备二维码…」、用户以为点了没反应。
 */
async function waitForQr(
  browser: BrowserBackend,
  emitQr: (qrDataUrl: string | null) => void,
  opts?: { signal?: AbortSignal; stepMs?: number; maxWaitMs?: number },
): Promise<string> {
  const stepMs = opts?.stepMs ?? 500
  const giveUpAt = Date.now() + (opts?.maxWaitMs ?? 30_000)
  for (;;) {
    // UI 关掉二维码弹窗必须立刻停:登录持全局浏览器锁,这里多转一圈,排队的抓取就多等 500ms。
    if (opts?.signal?.aborted) throw new Error("扫码登录已取消")
    const q = await readQr(browser)
    if (q.src && !q.expired) {
      emitQr(q.src)
      log.xhs.qrReady()
      return q.src
    }
    if (Date.now() > giveUpAt) {
      log.xhs.qrMissing()
      throw new Error("二维码未出现(登录弹窗可能未打开或二维码已失效,请重试)")
    }
    await new Promise((r) => setTimeout(r, stepMs))
  }
}

/**
 * 拿一张**可用**的二维码推给 UI（首屏 + 轮询中途过期都走这里）。
 *
 * 过期码(上次登录残留的弹窗)先强制重载页面:弹窗随旧文档销毁,再点「登录」重开,
 * 拿到的就是新码。重载是幂等代价,只在真的过期时付。
 */
async function ensureFreshQr(
  browser: BrowserBackend,
  emitQr: (qrDataUrl: string | null) => void,
  opts?: { signal?: AbortSignal },
): Promise<string> {
  let q = await readQr(browser)
  if (q.expired) {
    await cdpNavigate(browser, XHS_BASE, true)
    log.xhs.loginNavigate({ url: XHS_BASE })
    await waitUntil(browser, `typeof window.__INITIAL_STATE__ !== 'undefined'`, 8_000, "xhs 首页 SSR 未挂载").catch(
      () => {},
    )
    q = await readQr(browser)
  }
  if (q.src && !q.expired) {
    emitQr(q.src)
    log.xhs.qrReady()
    return q.src
  }
  await clickLoginButton(browser)
  return waitForQr(browser, emitQr, { signal: opts?.signal })
}

export async function xhsScanLogin(
  browser: BrowserBackend,
  emitQr: (qrDataUrl: string | null) => void,
  opts?: XhsScanLoginOptions,
): Promise<LoginResult> {
  // 登录跑在专属 login lane(login:xhs 的独立 tab):刷新在自己 lane 上,不会再把
  // 登录弹窗导航走;手机确认后页面自身的 qrcode/status 轮询不受刷新影响。
  // ⚠️ 刻意**不传 platform**:冷却期正是用户需要重新扫码自救的时候,不能被 browserGate
  // 拦住。
  return withScanLoginLock(browser, "hidden", (b) => runScanLogin(b, emitQr, opts), "xhs")
}

async function runScanLogin(
  browser: BrowserBackend,
  emitQr: (qrDataUrl: string | null) => void,
  opts?: XhsScanLoginOptions,
): Promise<LoginResult> {
  const timeoutMs = opts?.timeoutMs ?? 300_000
  const deadline = Date.now() + timeoutMs
  // UI 关闭二维码弹窗时 abort:没有取消通道的话,登录会把浏览器锁占满 5 分钟,
  // 期间所有 xhs/weibo 浏览器操作(刷新/详情/翻页)都被排队卡住。
  const assertLive = () => {
    if (opts?.signal?.aborted) throw new Error("扫码登录已取消")
  }

  // 1. 导航到小红书首页(直接 /login 可能 404;首页右上角有「登录」按钮)。
  // ⚠️ **强制重载**:login lane 的 tab 跨扫码复用,不重载会留着上次的文档 ——
  // `user.loggedIn` 可能是失效前渲染的 true,于是短路成「已登录（无需重复扫码）」并把
  // 旧 cookie 写回去,用户看到的就是「重新扫码没有覆盖旧登录」(2026-10-30)。
  assertLive()
  await cdpNavigate(browser, XHS_BASE, true)
  log.xhs.loginNavigate({ url: XHS_BASE })
  // 等首页 SSR 挂载再判登录态(否则会把已登录误判成未登录,白出一次二维码)。
  await waitUntil(browser, `typeof window.__INITIAL_STATE__ !== 'undefined'`, 8_000, "xhs 首页 SSR 未挂载").catch(
    () => {},
  )

  // 1.5 登录态检测。⚠️ 初始检测**只用页面证据**(user.loggedIn / 侧栏「我」):
  //     服务端 session 失效时 profile 里可能残留上次的 user_id cookie,信它会把
  //     过期凭证当「已登录」写库,用户永远出不了码(只能清除凭证自救)。
  const initial = await loginState(browser, { preferPageState: true })
  if (initial.loggedIn) {
    log.xhs.loginReused()
    return { cookie: serializeCookies(initial.cookies), user_id: initial.userId, alreadyLoggedIn: true }
  }
  // 轮询基线:扫码成功的标志是 user_id **从无到有/变化**,残留的旧值不算。
  const baselineUserId = initial.userId

  // 2. 拿一张可用二维码(过期码先重载换新,没弹窗就点「登录」打开)。
  await ensureFreshQr(browser, emitQr, { signal: opts?.signal })

  // 3. 用户扫码后 Edge 页面自身轮询确认登录。我们等**真正的登录态**翻转
  //    (user.loggedIn / 新 user_id),而不是游客 web_session(~1s/次;~4min 二维码有效期)。
  let final: Awaited<ReturnType<typeof loginState>> | undefined
  for (let i = 1; ; i++) {
    assertLive()
    const s = await loginState(browser, { baselineUserId })
    if (s.loggedIn) {
      final = s
      break
    }
    // 没人扫(~2min 有效)码会自己过期:中途换一张新码推给 UI,别让用户扫到废码。
    // 每 15 轮(~15s)才查一次,不增加轮询开销。
    if (i % 15 === 0) {
      const q = await readQr(browser)
      if (q.expired) await ensureFreshQr(browser, emitQr, { signal: opts?.signal }).catch(() => {})
    }
    if (Date.now() > deadline) {
      log.xhs.loginTimeout()
      throw new Error("扫码登录超时或二维码已失效")
    }
    await new Promise((r) => setTimeout(r, 1_000))
  }

  // 4. 取回 cookie 全量(含 HttpOnly web_session,供 HTTP 降级路径)与 user_id。
  const cookie = serializeCookies(final.cookies)
  log.xhs.loginOk({ user_id: final.userId })
  return { cookie, user_id: final.userId }
}
