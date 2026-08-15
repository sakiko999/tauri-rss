/**
 * weibo:user —— 微博用户主页 channel(kind: social)。
 *
 * 两步 container/getIndex(参考 RSSHub `weibo/user.ts`):
 *   1. `type=uid&value={uid}` → userInfo + tabsInfo.containerid;
 *   2. `type=uid&value={uid}&containerid={containerid}` → cards(微博列表)。
 * cards 过滤按 `c.mblog` 存在性(不按 card_type——JSON 里是数字 9)。
 * 长文展开 + 图宽高兜底由 mblogCardsToItems 统一处理(与热搜词流一致)。
 * 需完整登录 cookie(SUB),core 层 DEFAULT_WEIBO_COOKIE 经 info.cookie 注入。
 *
 * ⚠️ 浏览器路径(2026-08):Tauri 注入 appHost.browser(CDP 附加真实 Edge)时,
 * 用浏览器页面 fetch 打 m.weibo.cn——自动带 Edge profile 登录态,绕开冷 cookie
 * 时效问题(微博 cookie 几分钟就失效)。未注入时降级现有 HTTP + cookie 路径。
 */
import type { Item } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch } from "../factory.ts"
import { WB_BASE, mblogCardsToItems, weiboClient } from "../../platform/weibo"
import { cdpJson, cdpNavigate } from "../../browser/cdp.ts"

export class WeiboUserChannel implements RssChannel {
  readonly key = "weibo:user"
  readonly name = "微博用户主页"
  readonly kind = "social" as const
  readonly sourceInfoTpl = [{ key: "uid", label: "用户 uid", required: true }]
  getSource(info: SourceInfo): RssSource {
    return { fetch: apiFetch(() => this.fetchItems(info), () => this.channelOptions(info)) }
  }

  private async fetchItems(info: SourceInfo): Promise<Item[]> {
    const uid = String(info.uid ?? "").trim()
    if (!/^\d+$/.test(uid)) throw new Error(`weibo:user 需要数字 uid,收到 "${uid}"`)
    const cookie = (info.cookie as string) || undefined
    const referer = `${WB_BASE}/u/${uid}`
    const browser = globalThis.appHost?.browser

    // 浏览器路径先导航到 m.weibo.cn:①页面 fetch 同源 API 无 CORS(about:blank/跨域
    // 会 Failed to fetch);②自动带浏览器 profile 登录态 cookie。
    if (browser) await cdpNavigate(browser, `${WB_BASE}/`)

    // 1. userInfo + containerid
    const s1 = browser
      ? await cdpJson<{ ok?: number; msg?: string; data?: any }>(
          browser,
          `${WB_BASE}/api/container/getIndex?type=uid&value=${uid}`,
          { referer },
        )
      : await weiboClient.getJson<{ ok?: number; msg?: string; data?: any }>(
          `${WB_BASE}/api/container/getIndex?type=uid&value=${uid}`,
          { cookie, referer },
        )
    if (s1?.ok !== 1) throw new Error(`weibo 用户信息失败: ${s1?.msg ?? "未知错误"}`)
    const containerId = s1.data?.tabsInfo?.tabs?.find((tb: any) => tb.tab_type === "weibo")?.containerid
    if (!containerId) throw new Error("weibo: 未找到用户微博 containerid")

    // 2. 微博列表 cards(过滤→归一→长文→图尺寸由 mblogCardsToItems 处理)。
    const s2 = browser
      ? await cdpJson<{ ok?: number; msg?: string; data?: { cards?: any[] } }>(
          browser,
          `${WB_BASE}/api/container/getIndex?type=uid&value=${uid}&containerid=${containerId}`,
          { referer },
        )
      : await weiboClient.getJson<{ ok?: number; msg?: string; data?: { cards?: any[] } }>(
          `${WB_BASE}/api/container/getIndex?type=uid&value=${uid}&containerid=${containerId}`,
          { cookie, referer },
        )
    if (s2?.ok !== 1) throw new Error(`weibo 微博列表失败: ${s2?.msg ?? "未知错误"}`)
    return mblogCardsToItems(s2.data?.cards ?? [], this.key, cookie)
  }

  private channelOptions(info: SourceInfo): SerializeOptions {
    return { channelTitle: `微博 · ${info.uid}`, channelLink: `https://weibo.com/u/${info.uid}` }
  }
}
