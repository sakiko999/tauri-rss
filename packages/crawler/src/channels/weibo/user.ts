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
import type { SerializeOptions } from "@tauri-playground/xml"
import type { Pageable, RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch, serializeWithTotal } from "../factory.ts"
import { WB_BASE, mblogCardsToItems, weiboClient } from "../../platform/weibo"
import { cdpJson, cdpNavigate, withBrowserLock } from "../../browser/cdp.ts"

export class WeiboUserChannel implements RssChannel {
  readonly key = "weibo:user"
  readonly name = "微博用户主页"
  readonly kind = "social" as const
  readonly sourceInfoTpl = [{ key: "uid", label: "用户 uid", required: true }]
  getSource(info: SourceInfo): RssSource & Pageable {
    return {
      fetch: apiFetch(
        () => this.fetchItems(info).then((r) => ({ items: r.items, total: r.total })),
        () => this.channelOptions(info),
      ),
      // ⚠️ m.weibo.cn 容器翻页用 since_id 游标(滚动加载),page 参数无效(实测 page=2 返空)。
      // cursor = 上次响应最后一条 mblog 的 mid。
      fetchMore: (cursor?: string) => this.fetchMore(info, cursor),
    }
  }

  /** 翻页:since_id 游标,返回新 XML + 新游标(本页为空 = 没有更多)。total 每次响应恒定,一并透传。 */
  private async fetchMore(info: SourceInfo, sinceId?: string): Promise<{ xml: string; cursor?: string }> {
    // ⚠️ 首次翻页(sinceId 空):refresh 已消费首页——直接重拉首页会被 store 按 id 去重
    // → 0 新增 + hasMore true(用户要多点一次才翻第 2 页)。先取首页最后一条 mid 作 since_id。
    if (!sinceId) {
      const first = await this.fetchItems(info)
      if (!first.lastMid) return { xml: serializeWithTotal([], this.channelOptions(info), first.total) }
      sinceId = first.lastMid
    }
    const { items, lastMid, total } = await this.fetchItems(info, sinceId)
    const xml = serializeWithTotal(items, this.channelOptions(info), total)
    return { xml, ...(items.length && lastMid ? { cursor: lastMid } : {}) }
  }

  private async fetchItems(info: SourceInfo, sinceId?: string): Promise<{ items: Item[]; lastMid?: string; total?: number }> {
    const uid = String(info.uid ?? "").trim()
    if (!/^\d+$/.test(uid)) throw new Error(`weibo:user 需要数字 uid,收到 "${uid}"`)
    const cookie = (info.cookie as string) || undefined
    const referer = `${WB_BASE}/u/${uid}`
    const browser = globalThis.appHost?.browser

    // 浏览器路径:导航 + 两步 fetch 用 withBrowserLock 包成原子单元(单 Edge 共享,
    // 并发刷新会互相抢页面 → 页面停在别的域 fetch 变跨域 Failed to fetch)。
    if (browser) {
      return withBrowserLock(async () => {
        // ① 先导航到 m.weibo.cn:页面 fetch 同源 API 无 CORS;②自动带 profile 登录态。
        await cdpNavigate(browser, `${WB_BASE}/`)
        const s2 = await this.getIndex(uid, sinceId, (url) => cdpJson(browser, url, { referer }))
        return this.extractItems(s2, cookie)
      })
    }

    // HTTP 路径(无浏览器门面):两步 getIndex(仅传输不同,编排共用)。
    const s2 = await this.getIndex(uid, sinceId, (url) => weiboClient.getJson(url, { cookie, referer }))
    return this.extractItems(s2, cookie)
  }

  /**
   * 两步 getIndex:① userInfo + containerid ② cards(翻页带 since_id)。
   * 传输注入(浏览器 cdpJson / HTTP weiboClient.getJson),channel 只保留一份编排。
   */
  private async getIndex(
    uid: string,
    sinceId: string | undefined,
    fetchJson: (url: string) => Promise<{ ok?: number; msg?: string; data?: any }>,
  ): Promise<{ data?: { cards?: any[]; cardlistInfo?: { total?: number } } }> {
    const s1 = await fetchJson(`${WB_BASE}/api/container/getIndex?type=uid&value=${uid}`)
    if (s1?.ok !== 1) throw new Error(`weibo 用户信息失败: ${s1?.msg ?? "未知错误"}`)
    const containerId = s1.data?.tabsInfo?.tabs?.find((tb: any) => tb.tab_type === "weibo")?.containerid
    if (!containerId) throw new Error("weibo: 未找到用户微博 containerid")
    const s2 = await fetchJson(
      `${WB_BASE}/api/container/getIndex?type=uid&value=${uid}&containerid=${containerId}${sinceId ? `&since_id=${sinceId}` : ""}`,
    )
    if (s2?.ok !== 1) throw new Error(`weibo 微博列表失败: ${s2?.msg ?? "未知错误"}`)
    return s2
  }

  /** cards → { items, lastMid, total }(mblogCardsToItems 过滤归一 + 取最后一条
   * mblog 的 mid 作翻页游标 + cardlistInfo.total 作真实总数)。 */
  private async extractItems(
    s2: { data?: { cards?: any[]; cardlistInfo?: { total?: number } } },
    cookie?: string,
  ): Promise<{ items: Item[]; lastMid?: string; total?: number }> {
    const cards = s2.data?.cards ?? []
    const items = await mblogCardsToItems(cards, this.key, cookie)
    // 游标取「最后一条真 mblog」(cards 尾部混 type:58 占位卡,须跳过)的 mid;
    // mid 与 idstr 均可,mid 是标准翻页参数。空结果 = 没有更多。
    const lastMblog = [...cards].reverse().find((c: any) => c.mblog)
    const lastMid = lastMblog?.mblog?.mid ? String(lastMblog.mblog.mid) : undefined
    return { items, lastMid, total: s2.data?.cardlistInfo?.total }
  }

  private channelOptions(info: SourceInfo): SerializeOptions {
    return { channelTitle: `微博 · ${info.uid}`, channelLink: `https://weibo.com/u/${info.uid}` }
  }
}
