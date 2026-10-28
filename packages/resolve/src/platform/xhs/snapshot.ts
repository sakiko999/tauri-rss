import { serializeCookieDict } from "../../utils/cookie.ts"
import type { LoginCookieSnapshot } from "../types.ts"
/**
 * 小红书登录 cookie 快照 —— 应用启动时从抓取浏览器 profile **只读**取一份。
 *
 * 与 `xhsScanLogin` 的区别:不导航、不出码、不读页面 state(启动期不能为校验登录
 * 再访问一次小红书);只调 `browser.getCookies`(浏览器级、含 HttpOnly)。
 *
 * ⚠️ 登录标记用 `id_token`,不是 `web_session`/`user_id`:
 *   - `web_session` 对匿名访客也签发(游客会话),用它会把游客 cookie 当凭证;
 *   - `user_id` 在短信登录时可能不种,且 session 失效后可能残留(见 login.ts 的判据);
 *   - 实测:干净 Edge 匿名访问小红书时 cookie 集只有 a1/webId/websectiga/…(无
 *     web_session、无 id_token);当前扫码登录的抓取 profile 有 `id_token`(HttpOnly,
 *     与 web_session 同到期时间)。
 * 这仍不是「会话有效」的证明(服务端失效时 cookie 可能残留),只用来判断「浏览器里
 * 有没有登录材料」。失效由下一次抓取如实报错,不在启动期额外访问平台。
 */
import { XHS_BASE } from "./client.ts"

export async function readXhsLoginCookie(browser: BrowserBackend): Promise<LoginCookieSnapshot | null> {
  const cookies = await browser.getCookies(XHS_BASE)
  if (!cookies["id_token"]) return null
  return { cookie: serializeCookieDict(cookies), ...(cookies["user_id"] ? { user_id: cookies["user_id"] } : {}) }
}
