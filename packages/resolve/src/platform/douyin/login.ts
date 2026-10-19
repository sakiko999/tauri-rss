/**
 * douyin 扫码登录 —— **纯 HTTP 优先**,被 TLS 风控拦时回退浏览器(CDP 真实 Edge)。
 *
 * 纯 HTTP(协议参照社区 qrlogin 实现,sso.douyin.com 通行证):
 *   1. GET `sso.douyin.com/get_qrcode/` → `{data:{qrcode(base64 png), token}}`
 *   2. 轮询 GET `check_qrconnect/`(同参数 + token):status 1待扫 / 2已扫 /
 *      3已确认(带 redirect_url) / 5过期
 *   3. status=3 → GET redirect_url 收 Set-Cookie → 再 GET 主站补 ttwid 等 → 拼串
 *
 * ⚠️ 社区实现普遍用 curl_cffi(TLS 指纹伪装);宿主 Rust reqwest 无伪装,纯 HTTP
 * 路径可能被拦(get_qrcode 返非 JSON / 拿不到 token / 落地缺 sessionid)——任一
 * 失败即抛错,由 douyinScanLogin 回退 browser 路径(同 xhs 的 CDP 扫码)。
 * ⚠️ 宿主 http_get 自动 follow 重定向且只回**最终响应**的 headers:redirect_url
 * 若 302 链跳,中间跳的 Set-Cookie 会丢 → jar 里没有 sessionid 就当失败回退。
 *
 * 二维码载荷:HTTP 路径上游给 base64 png → 补上 data URL 前缀;browser 路径读到的
 * 本就是 data URL。两条路径 emitQr 推的都是 `data:image/...`(QrImage 直接当 img 用)。
 */
import { log } from "../../log.ts"
import { cdpEvaluate, cdpNavigate } from "../../browser/cdp.ts"
import type { LoginResult } from "../../index.ts"

const SSO = "https://sso.douyin.com"
const MAIN = "https://www.douyin.com"
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
const POLL_INTERVAL_MS = 2000

/** 登录态判定 cookie:出现即算已登录(sessionid 是 HttpOnly,浏览器路径须走 getCookies)。 */
const LOGIN_COOKIE = "sessionid"

/** 生成 verifyFp / s_v_web_id(抖音通行证接口要带;base36 毫秒时间 + 36 随机字符)。 */
function genVerifyFp(): string {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
  let base36 = ""
  let n = Date.now()
  while (n > 0) {
    base36 = "0123456789abcdefghijklmnopqrstuvwxyz"[n % 36] + base36
    n = Math.floor(n / 36)
  }
  let rand = ""
  for (let i = 0; i < 36; i++) rand += chars[Math.floor(Math.random() * chars.length)]
  return `verify_${base36}_${rand}`
}

/** get_qrcode / check_qrconnect 的公共 query(token 只在轮询时带)。 */
function qrParams(fp: string, token?: string): URLSearchParams {
  const p = new URLSearchParams({
    service: MAIN,
    need_logo: "false",
    need_short_url: "false",
    passport_jssdk_version: "1.0.20",
    aid: "6383",
    account_sdk_source: "sso",
    sdk_version: "2.2.7",
    language: "zh",
    verifyFp: fp,
    fp: fp,
  })
  if (token) p.set("token", token)
  return p
}

/** 一次扫码会话的 cookie jar:从响应 Set-Cookie 收集,拼请求 Cookie 头。 */
class CookieJar {
  private map = new Map<string, string>()

  absorb(headers: Record<string, unknown> | undefined): void {
    const raw = headers?.["set-cookie"]
    const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split("\n") : []
    for (const c of list) {
      const kv = String(c).split(";")[0]!.trim()
      const eq = kv.indexOf("=")
      if (eq > 0) this.map.set(kv.slice(0, eq), kv.slice(eq + 1))
    }
  }

  get header(): string {
    return [...this.map.entries()].map(([k, v]) => `${k}=${v}`).join("; ")
  }

  has(name: string): boolean {
    return this.map.has(name)
  }

  get names(): string[] {
    return [...this.map.keys()]
  }
}

/** 带 jar 请求;把响应 Set-Cookie 收进 jar,返回 body text(任意状态码不抛)。 */
async function fetchIntoJar(jar: CookieJar, url: string, referer: string): Promise<{ status: number; text: string }> {
  const res = await globalThis.appHost.http.request({
    url,
    method: "GET",
    responseType: "text",
    headers: { "user-agent": UA, referer, ...(jar.header ? { cookie: jar.header } : {}) },
  })
  jar.absorb(res.headers)
  return { status: res.status, text: typeof res.body === "string" ? res.body : String(res.body ?? "") }
}

/** 纯 HTTP 扫码(失败抛错,由调用方决定是否回退 browser)。 */
async function douyinHttpScanLogin(
  emitQr: (qr: string | null) => void,
  opts?: { timeoutMs?: number; onScanned?: () => void },
): Promise<LoginResult> {
  const deadline = Date.now() + (opts?.timeoutMs ?? 180_000)
  const jar = new CookieJar()
  const fp = genVerifyFp()

  // 主站 warmup:拿 ttwid 等基础 cookie(通行证接口对冷 cookie 更敏感)。失败不拦路。
  await fetchIntoJar(jar, `${MAIN}/`, MAIN).catch(() => undefined)

  // 1. 申请二维码。
  const qrRes = await fetchIntoJar(jar, `${SSO}/get_qrcode/?${qrParams(fp).toString()}`, `${MAIN}/`)
  let payload: any = null
  try {
    payload = JSON.parse(qrRes.text)
  } catch {
    throw new Error(`douyin 扫码: get_qrcode 返回非 JSON(HTTP ${qrRes.status},疑似 TLS 风控)`)
  }
  const token = String(payload?.data?.token ?? "")
  const qrcode = String(payload?.data?.qrcode ?? "")
  if (!token || !qrcode) throw new Error("douyin 扫码: get_qrcode 未返回 token/qrcode")
  emitQr(qrcode.startsWith("data:") ? qrcode : `data:image/png;base64,${qrcode}`)
  log.douyin.info("二维码已下发(HTTP 路径)")

  // 2. 轮询扫码状态(1待扫 / 2已扫 / 3已确认 / 5过期)。
  for (;;) {
    if (Date.now() > deadline) throw new Error("douyin 扫码: 超时未完成")
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    const poll = await fetchIntoJar(jar, `${SSO}/check_qrconnect/?${qrParams(fp, token).toString()}`, `${MAIN}/`)
    let data: any = null
    try {
      data = JSON.parse(poll.text)?.data
    } catch {
      continue // 单次轮询瞬态失败,继续等
    }
    const status = String(data?.status ?? "")
    if (status === "2") opts?.onScanned?.()
    if (status !== "3" && !data?.redirect_url) {
      if (status === "5") throw new Error("douyin 扫码: 二维码已过期")
      continue
    }

    // 3. 已确认:跟随 redirect_url 落地登录 cookie,再访问主站补全。
    const redirect = String(data?.redirect_url ?? "")
    if (redirect) await fetchIntoJar(jar, redirect, `${MAIN}/`)
    await fetchIntoJar(jar, `${MAIN}/`, MAIN)
    if (!jar.has(LOGIN_COOKIE)) {
      throw new Error(`douyin 扫码: 确认后未取到 ${LOGIN_COOKIE}(cookie: ${jar.names.join(",") || "空"})`)
    }
    log.douyin.info("扫码登录成功(HTTP 路径)")
    return { cookie: jar.header }
  }
}

/* ── browser 回退路径(CDP 真实 Edge,同 xhs/login.ts 模式) ─────────────────── */

/** Record → "k=v; k2=v2"(含 HttpOnly,getCookies 读出来的)。 */
function serializeCookies(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ")
}

/** 点首页「登录」按钮触发登录弹窗(douyin 的按钮带 data-e2e=login-button,文本兜底)。 */
async function clickLoginButton(browser: BrowserBackend): Promise<boolean> {
  return cdpEvaluate<boolean>(
    browser,
    `(() => {
      const el = [...document.querySelectorAll('button, a, [data-e2e]')].find(
        (n) => n.getAttribute('data-e2e') === 'login-button'
          || ((n.tagName === 'BUTTON' || n.tagName === 'A')
            && n.textContent && n.textContent.trim() === '登录' && n.offsetParent !== null),
      );
      if (!el) return false;
      el.click();
      return true;
    })()`,
  )
}

/**
 * 读登录弹窗里的二维码 data URL。douyin 弹窗内是 canvas 渲染,弹窗容器定位:
 * 含「扫码登录」文案且带 canvas/img 的**最小** div(canvas 转出来)。
 */
async function readQrSrc(browser: BrowserBackend): Promise<string | null> {
  return cdpEvaluate<string | null>(
    browser,
    `(() => {
      const roots = [...document.querySelectorAll('div')].filter(
        (d) => (d.textContent || '').includes('扫码登录') && d.querySelector('canvas, img'),
      );
      const root = roots.sort((a, b) => a.innerHTML.length - b.innerHTML.length)[0] || document;
      const img = root.querySelector('img[src^="data:image"]');
      if (img) return img.src;
      const cv = root.querySelector('canvas');
      if (cv) { try { return cv.toDataURL('image/png'); } catch { return null; } }
      return null;
    })()`,
  )
}

async function douyinBrowserScanLogin(
  browser: BrowserBackend,
  emitQr: (qr: string | null) => void,
  opts?: { timeoutMs?: number },
): Promise<LoginResult> {
  const deadline = Date.now() + (opts?.timeoutMs ?? 180_000)

  await cdpNavigate(browser, MAIN)
  log.douyin.info(`扫码登录导航 ${MAIN}(browser 路径)`)

  // 已登录检测:Edge profile 里已有 sessionid → 跳过扫码。
  const initial = await browser.getCookies(MAIN)
  if (initial[LOGIN_COOKIE]) {
    log.douyin.info("已登录(profile 复用)")
    return { cookie: serializeCookies(initial), alreadyLoggedIn: true }
  }

  // 出码:弹窗未开则点「登录」,轮询 canvas/-img 渲染(500ms/次)。
  if (!(await readQrSrc(browser))) {
    await clickLoginButton(browser)
    for (;;) {
      const src = await readQrSrc(browser)
      if (src) break
      if (Date.now() > deadline) throw new Error("二维码未出现(登录弹窗可能未打开)")
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  emitQr(await readQrSrc(browser))

  // 用户扫码确认后 cookie 落 profile,轮询 sessionid(含 HttpOnly)。
  for (;;) {
    const c = await browser.getCookies(MAIN)
    if (c[LOGIN_COOKIE]) {
      log.douyin.info("登录成功(browser 路径)")
      return { cookie: serializeCookies(c) }
    }
    if (Date.now() > deadline) throw new Error("扫码登录超时或二维码已失效")
    await new Promise((r) => setTimeout(r, 1000))
  }
}

/**
 * 完整扫码登录:纯 HTTP 优先(移动端/无 browser 环境唯一路径),被风控拦且注入了
 * appHost.browser 时回退 CDP 路径。返回 LoginResult(cookie 由 core 落 settings)。
 */
export async function douyinScanLogin(
  emitQr: (qr: string | null) => void,
  opts?: { timeoutMs?: number; onScanned?: () => void },
): Promise<LoginResult> {
  try {
    return await douyinHttpScanLogin(emitQr, opts)
  } catch (e) {
    const browser = globalThis.appHost?.browser
    if (!browser) throw e // 无 browser(如移动端)只能抛给 UI
    log.douyin.warn(`HTTP 路径失败,回退浏览器: ${(e as Error).message}`)
    emitQr(null) // 作废旧码,UI 回到「准备二维码」态
    return douyinBrowserScanLogin(browser, emitQr, opts)
  }
}
