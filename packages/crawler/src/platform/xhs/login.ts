/**
 * xhs 扫码登录 —— 浏览器路径(CDP 附加真实 Edge)。
 *
 * 导航到小红书首页 → 点「登录」触发登录弹窗 → 读 `img.qrcode-img` 的 base64
 * data URL → emitQr 推给 UI → 用户手机扫码 → Edge 页面自身轮询 qrcode/status
 * (浏览器签名真实)确认登录 → 检测 document.cookie 出现 web_session 即成功。
 * cookie 落 Edge profile(--user-data-dir 持久化),返回串供 core 落 settings
 * (HTTP 降级路径复用)。
 *
 * 全部走 Runtime.evaluate(读 DOM / cookie),**零 CDP 网络拦截**——二维码是
 * 页面已渲染的 data URL(非截屏),登录态检测是 document.cookie 轮询。
 */
import { XHS_BASE } from "./client.ts"
import { cdpNavigate } from "../../browser/cdp.ts"
import { log } from "../../log.ts"
import type { LoginResult } from "../../index.ts"

export interface XhsScanLoginOptions {
  /** 总超时(默认 5 分钟;xhs 二维码约 4 分钟有效,留余量)。 */
  timeoutMs?: number
}

/** Record → "k=v; k2=v2" cookie 串(含 HttpOnly,供 HTTP 降级路径用)。 */
function serializeCookies(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ")
}

/** 读二维码 data URL(找不到返回 null)。img.qrcode-img 为主,canvas.qrcode 兜底。 */
async function readQrSrc(browser: BrowserBackend): Promise<string | null> {
  return browser.evaluate<string | null>(
    `(() => {
      const img = document.querySelector('img.qrcode-img');
      if (img && img.src) return img.src;
      const cv = document.querySelector('canvas.qrcode');
      if (cv) {
        try { return cv.toDataURL('image/png'); } catch { return null; }
      }
      return null;
    })()`,
    { awaitPromise: false, returnByValue: true },
  )
}

/** 点「登录」按钮(首页顶部),触发登录弹窗。返回是否点到。 */
async function clickLoginButton(browser: BrowserBackend): Promise<boolean> {
  return browser.evaluate<boolean>(
    `(() => {
      const el = [...document.querySelectorAll('button, a')].find(
        (n) => n.textContent && n.textContent.trim() === '登录' && (n as HTMLElement).offsetParent !== null
      );
      if (!el) return false;
      (el as HTMLElement).click();
      return true;
    })()`,
    { awaitPromise: false, returnByValue: true },
  )
}

/** 轮询二维码 data URL 出现(点按钮后登录弹窗 JS 渲染)。 */
async function waitForQr(
  browser: BrowserBackend,
  emitQr: (qrDataUrl: string | null) => void,
  deadline: number,
  stepMs = 500,
): Promise<string> {
  for (;;) {
    const src = await readQrSrc(browser)
    if (src) {
      emitQr(src)
      log.xhs.qrReady()
      return src
    }
    if (Date.now() > deadline) {
      log.xhs.qrMissing()
      throw new Error("二维码未出现(登录弹窗可能未打开)")
    }
    await new Promise((r) => setTimeout(r, stepMs))
  }
}

export async function xhsScanLogin(
  browser: BrowserBackend,
  emitQr: (qrDataUrl: string | null) => void,
  opts?: XhsScanLoginOptions,
): Promise<LoginResult> {
  const timeoutMs = opts?.timeoutMs ?? 300_000
  const deadline = Date.now() + timeoutMs

  // 1. 导航到小红书首页(直接 /login 可能 404;首页右上角有「登录」按钮)。
  await cdpNavigate(browser, XHS_BASE)
  log.xhs.loginNavigate({ url: XHS_BASE })

  // 1.5 登录态检测:web_session 已在 cookie(Edge profile 已登录)→ 跳过扫码直接返回,
  //     避免「已登录再点登录」触发无意义的扫码/报错。
  //     ⚠️ document.cookie 读不到 HttpOnly(web_session 是 HttpOnly),必须走 CDP
  //     Network.getAllCookies(browser.getCookies)。
  const initialCookies = await browser.getCookies(XHS_BASE)
  if (initialCookies["web_session"]) {
    log.xhs.loginOk({ user_id: initialCookies["user_id"] })
    return { cookie: serializeCookies(initialCookies), alreadyLoggedIn: true }
  }

  // 2. 二维码未出现则点「登录」按钮触发登录弹窗,再等二维码渲染。
  const existing = await readQrSrc(browser)
  if (existing) {
    emitQr(existing)
    log.xhs.qrReady()
  } else {
    await clickLoginButton(browser)
    await waitForQr(browser, emitQr, deadline)
  }

  // 3. 用户扫码后 Edge 页面自身轮询确认登录,我们轮询 web_session cookie 出现
  //    (Network.getAllCookies 读 HttpOnly,~1s/次;~4min 二维码有效期)。
  for (;;) {
    const c = await browser.getCookies(XHS_BASE)
    if (c["web_session"]) break
    if (Date.now() > deadline) {
      log.xhs.loginTimeout()
      throw new Error("扫码登录超时或二维码已失效")
    }
    await new Promise((r) => setTimeout(r, 1_000))
  }

  // 4. 取回 cookie 全量(含 HttpOnly web_session,供 HTTP 降级路径)与 user_id。
  const cookies = await browser.getCookies(XHS_BASE)
  const cookie = serializeCookies(cookies)
  const userId = cookies["user_id"]
  log.xhs.loginOk({ user_id: userId })
  return { cookie, user_id: userId }
}
