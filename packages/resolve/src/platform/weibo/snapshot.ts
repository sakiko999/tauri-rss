/**
 * 微博登录 cookie 快照 —— 应用启动时从抓取浏览器 profile **只读**取一份。
 *
 * ⚠️ 域名就是消费方:所有微博 HTTP 请求(mblog 长文展开、热搜词搜索)都打
 * `m.weibo.cn`(`WB_BASE`)。CDP `Network.getCookies({urls})` 只返回匹配该 URL
 * 的域,所以 `https://weibo.com` 的快照**不含** `.weibo.cn` 的 SUB/SUBP/ALF 等。
 * 优先取 `https://m.weibo.cn`;只有 weibo.com 有登录态时(刚扫码、还没访问过
 * 移动站)退回它,下一次浏览器抓取/启动同步会自然补上移动域。
 *
 * 不合并两域:getCookies 返回扁平的 name→value,同名 SUB/SUBP 会被后读覆盖,
 * 而跨域字段混在一起对消费方没有意义。
 */

import { serializeCookieDict } from "../../utils/cookie.ts"
import type { LoginCookieSnapshot } from "../types.ts"

const WB_MOBILE = "https://m.weibo.cn"
const WB_DESKTOP = "https://weibo.com"

export async function readWeiboLoginCookie(browser: BrowserBackend): Promise<LoginCookieSnapshot | null> {
  const mobile = await browser.getCookies(WB_MOBILE)
  if (mobile["SUB"]) {
    return { cookie: serializeCookieDict(mobile), ...(mobile["SUBP"] ? { user_id: mobile["SUBP"] } : {}) }
  }
  const desktop = await browser.getCookies(WB_DESKTOP)
  if (!desktop["SUB"]) return null
  return { cookie: serializeCookieDict(desktop), ...(desktop["SUBP"] ? { user_id: desktop["SUBP"] } : {}) }
}
