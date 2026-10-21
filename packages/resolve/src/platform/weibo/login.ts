/**
 * weibo 扫码登录 —— 浏览器路径(CDP 附加真实 Edge),与 xhs/login.ts 同构。
 *
 * 流程:导航 passport 登录页 → 页面自带的二维码
 * `<img src="https://v2.qr.weibo.cn/inf/gen?api_key=...">`(**无需点按钮触发**)
 * → emitQr 推给 UI → 用户手机扫码 → 轮询 `SUB` cookie 出现即成功。
 *
 * ⚠️ 二维码 src 是本应用唯一需要展示的**远程**图:直接用 `<img src>` 会被 WebView
 * 的第三方存储限制拦掉(实测 "Tracking Prevention blocked access to storage",图
 * 不显示)。故经宿主隧道(appHost.http)取字节 → 转 data URL 再 emit。
 *
 * 与 xhs 的差别:二维码不是 data URL、也不需要点登录按钮;登录态判定用 `SUB`
 * (微博会话 cookie,HttpOnly → 只能经 CDP Network.getAllCookies 读)。
 */
import { cdpEvaluate, cdpNavigate, withScanLoginLock } from "../../browser/cdp.ts"
import { log } from "../../log.ts"
import type { LoginResult } from "../../index.ts"

/** passport 登录页(disp=popup 是内嵌登录页,布局稳定,含独立二维码 img)。 */
const LOGIN_URL =
  "https://passport.weibo.com/sso/signin?entry=miniblog&source=miniblog&disp=popup&url=https%3A%2F%2Fweibo.com"

export interface WeiboScanLoginOptions {
  /** 总超时(默认 5 分钟;微博二维码约 3~5 分钟有效)。 */
  timeoutMs?: number
  /** UI 关闭弹窗时 abort(登录持全局浏览器锁,必须可取消)。 */
  signal?: AbortSignal
}

/** Record → "k=v; k2=v2"(含 HttpOnly,供 HTTP 降级路径 / settings 落库用)。 */
function serializeCookies(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ")
}

/** 读二维码远程 src(找不到返回 null)。 */
async function readQrSrc(browser: BrowserBackend): Promise<string | null> {
  return cdpEvaluate<string | null>(
    browser,
    `(() => {
      // 二维码是 v2.qr.weibo.cn 的 gen 图(180x180),按域名/尺寸定位,不依赖易变的 class。
      const img = [...document.querySelectorAll('img')].find(
        (i) => /v2\\.qr\\.weibo\\.cn|qr\\.weibo\\.cn/.test(i.src) || (/inf\\/gen/.test(i.src))
      );
      return img && img.src ? img.src : null;
    })()`,
  )
}

/**
 * 远程二维码图 → data URL。
 *
 * ⚠️ 走 `appHost.http` 的 **arraybuffer**(不是 httpGet 的 text):二维码是二进制 PNG,
 * 按 utf-8 解码会损坏字节。与 ui/MediaImage 的隧道拉图同款。
 * 失败则回退原 src —— 至少给 UI 一个能试的 URL,而不是整条登录路径直接失败。
 */
async function qrToDataUrl(src: string): Promise<string> {
  try {
    const res = await globalThis.appHost.http.request({
      url: src,
      method: "GET",
      responseType: "arraybuffer",
      headers: { Referer: "https://passport.weibo.com/" },
    })
    if (res.status < 200 || res.status >= 300) return src
    const ct = (res.headers["content-type"] ?? res.headers["Content-Type"] ?? "image/png") as string
    const bytes = res.body as Uint8Array
    let bin = ""
    for (const b of bytes) bin += String.fromCharCode(b)
    return `data:${ct.split(";")[0]};base64,${btoa(bin)}`
  } catch {
    return src
  }
}

/**
 * 微博扫码登录。
 *
 * 成功后 cookie 已落 Edge profile(--user-data-dir 持久化),返回的全量 cookie 串
 * 供 core 落 settings(DEFAULT/live 抓取时经 sourceInfoFor 注入)。
 */
export async function weiboScanLogin(
  browser: BrowserBackend,
  emitQr: (qr: string | null) => void,
  opts?: WeiboScanLoginOptions,
): Promise<LoginResult> {
  // 与 xhs 同构:专属 login lane(login:weibo);不传 platform —— 冷却期仍需允许用户
  // 重新扫码自救。
  return withScanLoginLock(browser, "hidden", (b) => runWeiboScanLogin(b, emitQr, opts), "weibo")
}

async function runWeiboScanLogin(
  browser: BrowserBackend,
  emitQr: (qr: string | null) => void,
  opts?: WeiboScanLoginOptions,
): Promise<LoginResult> {
  const timeoutMs = opts?.timeoutMs ?? 300_000
  const deadline = Date.now() + timeoutMs
  // UI 关闭弹窗时 abort(同 xhs:登录持全局浏览器锁,必须可取消)。
  const assertLive = () => {
    if (opts?.signal?.aborted) throw new Error("扫码登录已取消")
  }

  assertLive()
  await cdpNavigate(browser, LOGIN_URL, true)
  log.weibo?.loginNavigate?.({ url: LOGIN_URL })

  // 1. 已登录(SUB 已在 profile)→ 直接返回,避免无意义扫码。
  //    ⚠️ SUB 是 HttpOnly,document.cookie 读不到,必须走 CDP getAllCookies。
  const initial = await browser.getCookies("https://weibo.com")
  if (initial["SUB"]) {
    return { cookie: serializeCookies(initial), alreadyLoggedIn: true }
  }

  // 2. 二维码是页面自带的 img(不用点按钮);等它渲染出来。
  for (;;) {
    assertLive()
    const src = await readQrSrc(browser)
    if (src) {
      emitQr(await qrToDataUrl(src))
      break
    }
    if (Date.now() > deadline) throw new Error("微博二维码未出现(登录页结构可能已变)")
    await new Promise((r) => setTimeout(r, 500))
  }

  // 3. 轮询 SUB 出现 = 用户扫码成功(页面自身完成确认与种 cookie)。
  for (;;) {
    assertLive()
    const c = await browser.getCookies("https://weibo.com")
    if (c["SUB"]) {
      emitQr(null)
      log.weibo?.loginOk?.({ user_id: c["SUBP"] ?? c["ALF"] })
      return { cookie: serializeCookies(c) }
    }
    if (Date.now() > deadline) throw new Error("扫码登录超时或二维码已失效")
    await new Promise((r) => setTimeout(r, 1_000))
  }
}
