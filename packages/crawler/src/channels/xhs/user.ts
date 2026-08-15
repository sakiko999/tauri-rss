/**
 * xhs:user —— 小红书用户笔记 channel(kind: social)。
 *
 * 小红书已把用户页笔记改为 JS/API 动态加载,SSR 不再内嵌(`user.notes` 空分组)——
 * 走 `user_posted` API(edith.xiaohongshu.com),需签名 + 登录 cookie(web_session)。
 *
 * 双路径:
 *   - 浏览器(Tauri appHost.browser,CDP 附加真实 Edge):先导航到 xiaohongshu.com
 *     加载 `_webmsxyw` 签名脚本 → 页面上下文 fetch user_posted(签名 + 登录态 +
 *     环境指纹全在真实浏览器,绕开 reqwest 406 / 纯算法 461 / b1 指纹死结)。
 *   - HTTP(无 browser 门面):⚠️ 已降级(2026-08-15)——signApiHeaders 抛错,不产出。
 */
import type { Item, Social } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch } from "../factory.ts"
import { now } from "../../host.ts"
import { XHS_API_BASE, XHS_BASE, apiNoteToSocial, xhsClient } from "../../platform/xhs"
import { cdpNavigate, waitUntil } from "../../browser/cdp.ts"

export class XhsUserChannel implements RssChannel {
  readonly key = "xhs:user"
  readonly name = "小红书用户笔记"
  readonly kind = "social" as const
  readonly sourceInfoTpl = [{ key: "user_id", label: "用户 ID(24 位)", required: true }]
  getSource(info: SourceInfo): RssSource {
    return { fetch: apiFetch(() => this.fetchItems(info), () => this.channelOptions(info)) }
  }

  private async fetchItems(info: SourceInfo): Promise<Item[]> {
    const userId = String(info.user_id ?? "").trim()
    if (!userId) throw new Error("xhs:user 需要 user_id")
    const cookie = (info.cookie as string) || ""
    const url = `${XHS_API_BASE}/api/sns/web/v1/user_posted?num=30&cursor=&user_id=${userId}`
    const browser = globalThis.appHost?.browser

    let body: { data?: { notes?: any[] } } | null
    if (browser) {
      body = await this.fetchViaBrowser(browser, url)
    } else {
      // 签名种子 a1 来自会话 cookie,无 cookie(匿名)签名无效 → API 406/风控。
      // xhsClient.getJson 从 URL 反向提取签名参数(uri+params 同源)。
      body = await xhsClient.getJson<{ data?: { notes?: any[] } }>(url, { cookie })
    }
    const notes = body?.data?.notes ?? []
    const t = now()
    return notes
      .map((n: any): Social | null => apiNoteToSocial(n, this.key, t))
      .filter((x): x is Social => !!x)
  }

  /**
   * 浏览器路径:导航到小红书加载 `_webmsxyw`,页面内调它生成签名头,
   * 再 fetch user_posted(签名 + 登录态 + 环境指纹全在真实浏览器,绕开 reqwest 406)。
   */
  private async fetchViaBrowser(browser: BrowserBackend, url: string): Promise<{ data?: { notes?: any[] } } | null> {
    // 确保已在 xhs 域(加载签名脚本 + 登录态)。幂等:已在该域则 location.href 同址不重载。
    await cdpNavigate(browser, XHS_BASE)
    // 等待签名脚本挂载(_webmsxyw 是页面暴露的签名入口)。
    await waitUntil(browser, `typeof window._webmsxyw === 'function'`, 15_000, "xhs 签名脚本(_webmsxyw)未加载")

    // 页面内:调 _webmsxyw 生成签名头 → fetch。签名参数与 xhshow sign_headers_get 一致
    // (uri 含 query、data 为参数串);返回头对象或 {x-s} 串,并入 fetch headers。
    const expression = `(async () => {
      const u = new URL(${JSON.stringify(url)});
      const uri = u.pathname + u.search;
      let sign = {};
      try {
        const s = await window._webmsxyw(uri, '');
        if (s) sign = typeof s === 'string' ? { 'x-s': s } : s;
      } catch (e) { /* 签名失败走无签名(匿名 406 预期) */ }
      const res = await fetch(u.href, { headers: { ...sign } });
      return { status: res.status, bodyText: await res.text() };
    })()`
    const res = await browser.evaluate<{ status: number; bodyText: string }>(expression, {
      awaitPromise: true,
      returnByValue: true,
    })
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`xhs user_posted HTTP ${res.status}: ${res.bodyText.slice(0, 120)}`)
    }
    const text = res.bodyText
    if (text.trim() === "") return null
    return JSON.parse(text) as { data?: { notes?: any[] } }
  }

  private channelOptions(info: SourceInfo): SerializeOptions {
    return {
      channelTitle: `小红书 · ${info.user_id}`,
      channelLink: `${XHS_BASE}/user/profile/${info.user_id}`,
    }
  }
}
