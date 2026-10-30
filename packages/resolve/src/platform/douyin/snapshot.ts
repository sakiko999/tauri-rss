/**
 * 抖音登录 cookie 快照 —— 应用启动时从抓取浏览器 profile **只读**取一份。
 *
 * 与 `douyinScanLogin` 的区别：不导航、不出码、不读页面 state（启动期不能为了
 * 取快照再访问一次抖音）；只调 `browser.getCookies`（浏览器级、含 HttpOnly）。
 *
 * ⚠️ 为什么必须有这一步：抖音桌面侧的登录态消费方全是 **HTTP 路径**
 * （`stream.ts` 直播流解析、`profile.ts` 主页、`client.ts` 各请求都走
 * `douyinCookie()` → settings.douyinCookie），不像 xhs 那样直接用 profile。
 * 扫码当时写一次 settings 之后，浏览器侧再登录/换号都不会回流 —— 共用 profile 的
 * 调试实例（dev）因此看不到安装版里的抖音登录态（2026-10-30 实测）。
 *
 * 登录标记 = `sessionid`（与 `douyin/login.ts` 的 LOGIN_COOKIE 同一个判据；
 * `ttwid` 匿名访客也会签发，不能用来判断）。快照只说明「浏览器里有登录材料」，
 * 会话是否还有效由下一次抓取如实报错。
 */

import { serializeCookieDict } from "../../utils/cookie.ts"
import type { LoginCookieSnapshot } from "../types.ts"

const DOUYIN_BASE = "https://www.douyin.com"

export async function readDouyinLoginCookie(browser: BrowserBackend): Promise<LoginCookieSnapshot | null> {
  const cookies = await browser.getCookies(DOUYIN_BASE)
  if (!cookies["sessionid"]) return null
  return { cookie: serializeCookieDict(cookies) }
}
